/**
 * /macro [save <name>] <cmd args> ; <cmd args>… | <name> | off [name]
 *
 * Forms:
 *  - /macro                        → list saved macros and what they run.
 *  - /macro save <name> <chain>    → persist the chain per character, then run it.
 *  - /macro <name>                 → run a saved macro.
 *  - /macro <chain>                → run a one-shot chain (kept as "last").
 *  - /macro off <name>             → stop the routines that macro armed.
 *  - /macro off                    → stop every active routine.
 *
 * A chain is command steps separated by ";" — spacing is free ("a ; b" and
 * "a;b" both work). Steps go through the same registry the REPL dispatches on,
 * so a macro drives any command except /macro itself (recursion) and /login (a
 * saved step would carry the password). A failing step is reported and the
 * chain carries on; saving is stricter and refuses a chain holding an unknown
 * or blocked step rather than persisting something that can never fully run.
 *
 * Macros are stored per character
 * (config.characters["<login>/<slot>"].macros[name] = ["autobuff xp", …]) —
 * same multi-config shape as /autobuff and /autoheal.
 */
import { saveConfig, charKey } from '../../config.js';
import { logCommand } from '../../debuglog.js';
import { log } from '../../log.js';

const SEP = ';';
const VERBS = { save: 1, off: 1, list: 1 };
// Never chainable: /macro would recurse (a saved macro could call itself), and
// /login would drop a password into config.local.json — stripSecrets only
// filters secret-looking *keys*, not a password sitting inside a step string.
const BLOCKED = { macro: 1, login: 1 };

// Macro name → { steps: [{ name, args, routines }] } for every chain run this
// session. Feeds `off <name>`, the listing and the reconnect replay. A one-shot
// chain lands under "last" — same reserved name as /autobuff's inline profile.
const armed = {};
let replayWired = false;

/**
 * Split a raw arg list into one token array per step. Tokens glued to the
 * separator are split too, so `xp;autoheal` and `xp ; autoheal` are the same
 * chain. Empty steps (`a ;; b`, trailing `;`) are dropped.
 *
 * @param {string[]} args
 * @returns {string[][]}
 */
export function splitSteps(args) {
	const steps = [];
	let cur = [];
	for (let i = 0, n = args.length; i < n; ++i) {
		const pieces = args[i].split(SEP);
		for (let p = 0, pn = pieces.length; p < pn; ++p) {
			if (p > 0) {
				steps.push(cur);
				cur = [];
			}
			if (pieces[p]) {
				cur.push(pieces[p]);
			}
		}
	}
	steps.push(cur);
	return steps.filter(step => step.length);
}

/** @returns {{name: string, args: string[], routines: string[]}[]} */
function toRecords(tokenSteps) {
	return tokenSteps.map(tokens => ({ name: tokens[0], args: tokens.slice(1), routines: [] }));
}

function recordText(step) {
	return step.args.length ? step.name + ' ' + step.args.join(' ') : step.name;
}

function savedMacros(cfg) {
	const chr = cfg.characters && cfg.characters[charKey(cfg)];
	return (chr && chr.macros) || {};
}

/**
 * Resolve a step name against the REPL's own registry (exposed on ctx, so this
 * file never imports registry.js — that would close a cycle).
 *
 * @returns {{cmd: ?object, reason: ?string}}
 */
function resolveStep(ctx, name) {
	const cmd = ctx.getCommand(name);
	if (!cmd) {
		return { cmd: null, reason: 'unknown command' };
	}
	if (BLOCKED[cmd.name]) {
		return { cmd: null, reason: 'not allowed in a macro' };
	}
	return { cmd, reason: null };
}

/**
 * Snapshot name → routine instance. Comparing instances (not just names) tells
 * a restart apart from a no-op: startRoutine() stops the previous instance
 * first, so a routine that was already running still counts as armed by the
 * step that relaunched it.
 */
function routineSnapshot(session) {
	const snap = {};
	const names = session.listRoutines();
	for (let i = 0, n = names.length; i < n; ++i) {
		snap[names[i]] = session.getRoutine(names[i]);
	}
	return snap;
}

/**
 * Run every step, reporting instead of aborting: a bad step costs one line and
 * the chain carries on. Each record's `routines` is filled in place with what
 * that step armed, which is what `off` and the reconnect replay work from.
 *
 * @param {object} ctx
 * @param {{name: string, args: string[], routines: string[]}[]} steps
 * @param {string} label macro name, for the debug trace
 * @returns {Promise<number>} how many steps succeeded
 */
async function runChain(ctx, steps, label) {
	const total = steps.length;
	let ok = 0;

	for (let i = 0, n = total; i < n; ++i) {
		const step = steps[i];
		const prefix = '  ' + (i + 1) + '/' + n + ' /' + step.name;
		const { cmd, reason } = resolveStep(ctx, step.name);
		step.routines = [];
		if (!cmd) {
			logCommand(step.name, step.args, { resolved: null, reason: reason, macro: label });
			log.event(prefix + ' — ' + reason);
			continue;
		}

		logCommand(step.name, step.args, { resolved: cmd.name, macro: label });
		const before = routineSnapshot(ctx.session);
		try {
			await cmd.run(ctx, step.args);
		} catch (err) {
			log.event(prefix + ' — ' + err.message);
			continue;
		}

		const after = ctx.session.listRoutines();
		for (let r = 0, rn = after.length; r < rn; ++r) {
			if (before[after[r]] !== ctx.session.getRoutine(after[r])) {
				step.routines.push(after[r]);
			}
		}
		++ok;
	}

	log.event(
		'macro "' + label + '": ' + ok + '/' + total + ' ok' + (ok === total ? '' : ' — ' + (total - ok) + ' failed')
	);
	return ok;
}

/**
 * After a reconnect, Session has already re-armed the routines that survived
 * (_rearmRoutines runs just before the 'reconnected' event). We replay only the
 * steps whose routine went missing — a healthy routine keeps its internal
 * state, and a non-routine step (say / emote) never re-fires.
 */
function wireReplay(ctx) {
	if (replayWired) {
		return;
	}
	replayWired = true;
	ctx.client.on('reconnected', () => {
		const active = ctx.session.listRoutines();
		for (const name in armed) {
			const stale = armed[name].steps.filter(
				step => step.routines.length && step.routines.some(r => active.indexOf(r) < 0)
			);
			if (stale.length) {
				log.event('macro "' + name + '" — re-arming ' + stale.length + ' step(s) after reconnect');
				runChain(ctx, stale, name); // records update in place; entry stays whole
			}
		}
	});
}

async function start(ctx, tokenSteps, name) {
	const steps = toRecords(tokenSteps);
	armed[name] = { steps };
	wireReplay(ctx);
	await runChain(ctx, steps, name);
}

function listMacros(ctx) {
	const saved = savedMacros(ctx.config);
	const active = ctx.session.listRoutines();
	let shown = 0;

	for (const name in saved) {
		++shown;
		log.event('  ' + name + ' — ' + saved[name].join(' ' + SEP + ' ') + running(name, active));
	}
	for (const name in armed) {
		if (saved[name]) {
			continue;
		}
		++shown;
		const text = armed[name].steps.map(recordText).join(' ' + SEP + ' ');
		log.event('  ' + name + ' (unsaved) — ' + text + running(name, active));
	}
	if (!shown) {
		log.event('no macro — /macro save <name> <cmd args> ' + SEP + ' <cmd args>…');
	}
}

/** Every routine a macro armed, deduped, in the order its steps armed them. */
function armedRoutines(name) {
	const out = [];
	const entry = armed[name];
	if (!entry) {
		return out;
	}
	const steps = entry.steps;
	for (let i = 0, n = steps.length; i < n; ++i) {
		const routines = steps[i].routines;
		for (let r = 0, rn = routines.length; r < rn; ++r) {
			if (out.indexOf(routines[r]) < 0) {
				out.push(routines[r]);
			}
		}
	}
	return out;
}

function running(name, active) {
	const live = armedRoutines(name).filter(r => active.indexOf(r) >= 0);
	return live.length ? '  [running: ' + live.join(', ') + ']' : '';
}

function stopMacro(ctx, name) {
	if (!armed[name]) {
		log.event('macro "' + name + '" is not running');
		return;
	}
	const stopped = armedRoutines(name).filter(r => ctx.session.stopRoutine(r));
	delete armed[name];
	log.event(
		stopped.length ? 'macro "' + name + '" stopped ' + stopped.join(', ') : 'macro "' + name + '" stopped nothing'
	);
}

function stopAll(ctx) {
	const active = ctx.session.listRoutines();
	for (let i = 0, n = active.length; i < n; ++i) {
		ctx.session.stopRoutine(active[i]);
	}
	for (const name in armed) {
		delete armed[name];
	}
	log.event(active.length ? 'stopped ' + active.join(', ') : 'no active routine');
}

async function saveMacro(ctx, args) {
	const name = args[1];
	if (!name || VERBS[name]) {
		log.event('usage: /macro save <name> <cmd args> ' + SEP + ' <cmd args>…');
		return;
	}
	const tokenSteps = splitSteps(args.slice(2));
	if (!tokenSteps.length) {
		log.event('macro "' + name + '" needs at least one step');
		return;
	}
	// Stricter than a run: refuse to persist a chain that can never fully run.
	for (let i = 0, n = tokenSteps.length; i < n; ++i) {
		const { reason } = resolveStep(ctx, tokenSteps[i][0]);
		if (reason) {
			log.event('step ' + (i + 1) + ' "/' + tokenSteps[i][0] + '" — ' + reason + '; macro not saved');
			return;
		}
	}

	const key = charKey(ctx.config);
	saveConfig({ characters: { [key]: { macros: { [name]: tokenSteps.map(tokens => tokens.join(' ')) } } } });
	log.event('saved macro "' + name + '" (' + tokenSteps.length + ' steps) for ' + key);
	await start(ctx, tokenSteps, name);
}

export default {
	name: 'macro',
	usage: '[save <name>] <cmd args> ' + SEP + ' <cmd args>… | <name> | off [name]',
	help: 'chain several commands under a name (auto-pilot in one shot)',
	async run(ctx, args) {
		if (!args.length || args[0] === 'list') {
			listMacros(ctx);
			return;
		}
		if (args[0] === 'save') {
			await saveMacro(ctx, args);
			return;
		}
		if (args[0] === 'off') {
			if (args[1]) {
				stopMacro(ctx, args[1]);
			} else {
				stopAll(ctx);
			}
			return;
		}

		// A single token names a saved macro (mirrors /autobuff's profile rule);
		// anything longer is a one-shot chain.
		if (args.length === 1) {
			const text = savedMacros(ctx.config)[args[0]];
			if (!Array.isArray(text)) {
				log.event('no macro "' + args[0] + '" — /macro to list');
				return;
			}
			await start(
				ctx,
				text.map(line => line.split(/\s+/).filter(Boolean)),
				args[0]
			);
			return;
		}

		const tokenSteps = splitSteps(args);
		if (!tokenSteps.length) {
			log.event('usage: /macro <cmd args> ' + SEP + ' <cmd args>…');
			return;
		}
		await start(ctx, tokenSteps, 'last');
	}
};
