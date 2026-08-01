/**
 * Node/macro/loader.js
 *
 * Loads and runs an operator-authored macro. A macro lives OUTSIDE the bundle
 * (<cwd>/macros/<name>.macro.js, alongside node-logs/ and config.local.json) so
 * it can be edited without a rebuild — which also means it gets no vite alias
 * resolution and must import NOTHING from the engine. Everything it needs
 * arrives through the injected bot (api/Bot.js):
 *
 *   export default async bot => { … };
 *
 * This module owns the AbortController that waitFor.js was written to accept:
 * one controller per run, its signal threaded through every await the bot makes,
 * so /stop, the file-drop stop (macro/stopfile.js) and a dropped connection all
 * abort the macro at once instead of at the next action boundary.
 *
 * Module-level state, no class: there is exactly one REPL driving one
 * connection, so a class would have to be instantiated somewhere and threaded
 * through the command ctx for nothing. Same shape as cli/commands/macro.js's
 * `armed` / `replayWired`. A single `_current` rather than a name-keyed map:
 * ClientSession.activeRoutines is mono *per name* because routines coexist —
 * here the invariant is stronger (one macro, full stop), so a key would encode
 * a state that cannot exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Bot } from '../api/Bot.js';
import { isAborted } from '../waitFor.js';
import { log } from '../log.js';

const DIR = 'macros';
const EXT = '.macro.js';

let _current = null; // { name, controller, gen, promise } — the in-flight run
let _resume = null; // the run a drop parked, awaiting its reconnect restart
let _gen = 0;
let _wired = false;

/** Absolute macros directory, anchored on the launch cwd (like node-logs/). */
export function macroDir() {
	return path.resolve(process.cwd(), DIR);
}

/** @returns {Array<string>} macro names without extension; empty if the dir is absent */
export function listMacros() {
	let entries;
	try {
		entries = fs.readdirSync(macroDir());
	} catch {
		return []; // no macros/ yet — /run prints where to create one
	}
	const out = [];
	for (let i = 0, n = entries.length; i < n; ++i) {
		const entry = entries[i];
		if (entry.length > EXT.length && entry.slice(-EXT.length) === EXT) {
			out.push(entry.slice(0, -EXT.length));
		}
	}
	return out;
}

/** @returns {?string} name of the running macro, or null */
export function runningMacro() {
	return _current ? _current.name : null;
}

/**
 * Import the macro file and return its default export.
 *
 * The specifier MUST be an opaque variable holding an absolute file:// URL. A
 * literal './macros/x.macro.js' gets statically resolved and INLINED into
 * dist-node/ (frozen at build time, so edits do nothing); a './macros/' + name
 * concatenation is left verbatim and then resolved by Node against dist-node/,
 * not the source tree — and `emptyOutDir` wipes that on every build. Only a
 * cwd-anchored pathToFileURL() survives both.
 *
 * The ESM cache keys on the URL, so the query carries the file mtime: an edited
 * macro is re-evaluated on the next /run with no process restart, while an
 * unchanged one reuses its cached module — which matters because the reconnect
 * path re-imports on every restart and module records are never collected.
 */
async function _load(name) {
	if (!/^[\w-]+$/.test(name)) {
		throw new Error('bad macro name "' + name + '" — letters, digits, _ and - only');
	}
	const file = path.join(macroDir(), name + EXT);
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		throw new Error('no macro "' + name + '" — expected ' + file);
	}
	const url = pathToFileURL(file).href + '?m=' + stat.mtimeMs;
	const mod = await import(/* @vite-ignore */ url);
	if (typeof mod.default !== 'function') {
		throw new Error('macro "' + name + '" must `export default async bot => {…}`');
	}
	return mod.default;
}

/**
 * Run one macro to completion. NEVER rejects — every outcome becomes a log
 * line, so `entry.promise` is a pure "this run is fully torn down" barrier the
 * reconnect path can await without a try/catch. An abort is a CLEAN STOP, not
 * an error: that is the whole point of the signal.
 *
 * The gen guard makes a late teardown harmless — only the run that still owns
 * the slot may clear it.
 */
async function _invoke(fn, bot, name, gen) {
	try {
		await fn(bot);
		log.event('macro "' + name + '" finished');
	} catch (err) {
		if (isAborted(err)) {
			log.event('macro "' + name + '" stopped');
		} else {
			// A macro is arbitrary user code and may `throw null` — reading
			// .message unguarded would throw inside this catch, so the promise
			// below would reject and the slot would stay occupied forever.
			log.error('macro "' + name + '": ' + (err && err.message ? err.message : String(err)));
		}
	}
	if (_current && _current.gen === gen) {
		_current = null;
	}
}

/**
 * @param {object} ctx REPL ctx (cli/repl.js) — only ctx.client is used
 * @param {string} name macro file base name
 * @returns {Promise<boolean>} false when it could not start
 */
export async function start(ctx, name) {
	if (_current) {
		log.event('macro "' + _current.name + '" is running — /stop first');
		return false;
	}
	let fn;
	try {
		fn = await _load(name);
	} catch (err) {
		log.error(err.message);
		return false;
	}

	_resume = null; // an explicit /run supersedes any pending reconnect restart
	_wire(ctx);

	const controller = new AbortController();
	const entry = { name, controller, gen: ++_gen, promise: null };
	_current = entry;
	log.event('macro "' + name + '" started');
	// _invoke runs synchronously up to its first await, so `promise` is assigned
	// before any continuation can observe the entry.
	entry.promise = _invoke(fn, new Bot(ctx.client, controller.signal), name, entry.gen);
	return true;
}

/**
 * Abort the running macro. Returns without awaiting the unwind: the abort is
 * synchronous and instant, which is what /stop promises — the macro's pending
 * waitFor / sleep rejects on the next microtask and _invoke logs the stop.
 *
 * @returns {?string} the stopped macro name, or null when nothing was running
 */
export function stop() {
	_resume = null; // an explicit stop also cancels a pending reconnect restart
	const entry = _current;
	if (!entry) {
		return null;
	}
	entry.controller.abort();
	return entry.name;
}

/**
 * One-time reconnect wiring — same lazy guard as cli/commands/macro.js: ctx is
 * only reachable from a command, and the listeners must survive every later /run.
 */
function _wire(ctx) {
	if (_wired) {
		return;
	}
	_wired = true;
	ctx.client.on('disconnected', () => _park('connection dropped'));
	ctx.client.on('reconnected', () => _onReconnected(ctx));
}

/** Abort the in-flight run and remember it as the one to restart. */
function _park(reason) {
	const entry = _current;
	if (!entry) {
		return;
	}
	_resume = entry;
	log.event('macro "' + entry.name + '" — aborted (' + reason + ')');
	entry.controller.abort();
}

/**
 * ClientSession emits 'reconnected' from its retry loop (always preceded by
 * 'disconnected') AND from returnToCharSelect (NEVER preceded by one) — hence
 * the _park here too, so /charselect cannot leave a macro acting against a map
 * the character just left.
 *
 * Ordering matters: park → await the parked run's promise → only then restart.
 * Without that barrier the restart would race the previous run's teardown, whose
 * trailing `_current = null` would then wipe the NEW entry and leave a live
 * macro /stop can no longer see.
 */
async function _onReconnected(ctx) {
	_park('char re-entry'); // no-op on the drop path — _current is already gone
	const parked = _resume;
	_resume = null; // cleared at once so a second event cannot double-restart
	if (!parked) {
		return;
	}
	await parked.promise;
	if (_current) {
		return; // the operator started something else while we were unwinding
	}
	log.event('macro "' + parked.name + '" — restarting after reconnect');
	await start(ctx, parked.name);
}
