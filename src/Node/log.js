/**
 * Node/log.js
 *
 * Leveled logger + output funnel for the headless Node client.
 *
 * Channels:
 *  - log(level,…) / log.event(…) / log.info/warn/error — ALWAYS shown.
 *  - log.routine(name,…) — shown at verbosity >= 1 (-v / --debug).
 *  - log.framework(…) / log.packet(…) — shown at verbosity >= 2 (-vv).
 *
 * All output goes through a single sink. Before the REPL mounts, the sink is
 * plain stdout/stderr; once cli/screen.js mounts it calls setSink() so every
 * line renders inside the scrolling events region (never clobbering the input
 * box). installConsoleGate() captures core's unconditional console.* packet
 * dumps so they stay hidden by default and only surface (routed to the sink)
 * at -vv.
 *
 * Imports node builtins only — stays loadable in the shim-preload order.
 */
import process from 'node:process';

const PREFIX = '[ro-node]';

let _verbosity = 0;
let _sink = null; // (text:string, stream:'out'|'err') => void

const _useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(code, s) {
	return _useColor ? '[' + code + 'm' + s + '[0m' : s;
}
const dim = s => paint('90', s); // bright-black / grey
const yellow = s => paint('33', s);
const red = s => paint('31', s);
const cyan = s => paint('36', s);

/**
 * @param {0|1|2} n 0 = quiet (events only), 1 = +routine debug, 2 = +framework/packets
 */
export function setVerbosity(n) {
	_verbosity = n | 0;
}
export function getVerbosity() {
	return _verbosity;
}

/**
 * Route every log line to a custom sink (the REPL screen). Pass null to
 * restore plain stdout/stderr.
 * @param {?function(string, ('out'|'err')): void} fn
 */
export function setSink(fn) {
	_sink = fn || null;
}

let _fileSink = null;

/**
 * Route EVERY log line (all channels, regardless of verbosity) to a file sink,
 * with clean (ANSI-free) text — the debug trace. Separate from the screen sink,
 * which stays verbosity-gated.
 * @param {?function(string, string): void} fn (channel, text) => void
 */
export function setFileSink(fn) {
	_fileSink = fn || null;
}

function toFile(channel, text) {
	if (_fileSink) {
		try {
			_fileSink(channel, text);
		} catch {
			// never let logging throw
		}
	}
}

function emit(text, stream) {
	if (_sink) {
		_sink(text, stream || 'out');
		return;
	}
	(stream === 'err' ? process.stderr : process.stdout).write(text + '\n');
}

function fmt(args) {
	const out = [];
	for (let i = 0, n = args.length; i < n; ++i) {
		const a = args[i];
		out.push(typeof a === 'string' ? a : safeStringify(a));
	}
	return out.join(' ');
}

function safeStringify(v) {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

/**
 * Back-compat entry: log(level, …args). info/warn/error are always shown.
 * @param {'info'|'warn'|'error'} level
 * @param {...*} args
 */
export function log(level, ...args) {
	const text = PREFIX + ' ' + fmt(args);
	toFile(level, text);
	if (level === 'error') {
		emit(red(PREFIX) + ' ' + fmt(args), 'err');
	} else if (level === 'warn') {
		emit(yellow(PREFIX) + ' ' + fmt(args), 'err');
	} else {
		emit(dim(PREFIX) + ' ' + fmt(args));
	}
}

// Always-on event channel (the top region's primary content).
log.event = (...args) => {
	const text = fmt(args);
	toFile('event', PREFIX + ' ' + text);
	emit(cyan(PREFIX) + ' ' + text);
};
log.info = (...args) => log('info', ...args);
log.warn = (...args) => log('warn', ...args);
log.error = (...args) => log('error', ...args);

/**
 * Routine-level debug — screen-visible at -v (verbosity >= 1), but always
 * written to the file sink. Tagged by routine name.
 * @param {string} name
 * @param {...*} args
 */
log.routine = (name, ...args) => {
	const text = '[' + name + '] ' + fmt(args);
	toFile('routine', text);
	if (_verbosity >= 1) {
		emit(dim(text));
	}
};

// Framework-internal debug — screen-visible at -vv (>= 2), always to the file.
log.framework = (...args) => {
	const text = PREFIX + ' [fw] ' + fmt(args);
	toFile('framework', text);
	if (_verbosity >= 2) {
		emit(dim(text));
	}
};

// Raw packet channel — visible at -vv only (core console.* is routed here).
log.packet = (...args) => {
	if (_verbosity >= 2) {
		emit(dim('[pkt] ' + fmt(args)));
	}
};

/**
 * Capture core modules' unconditional console.* output (NetworkManager logs
 * every packet). At verbosity < 2 the noise is dropped; at >= 2 it is routed
 * to the sink as a packet line. console.error is always surfaced.
 * Idempotent — safe to call once at boot.
 */
let _consoleGated = false;
export function installConsoleGate() {
	if (_consoleGated) {
		return;
	}
	_consoleGated = true;
	console.log = (...args) => log.packet(...args);
	console.info = (...args) => log.packet(...args);
	console.debug = (...args) => log.packet(...args);
	console.warn = (...args) => {
		if (_verbosity >= 2) {
			emit(yellow('[fw] ') + fmt(args), 'err');
		}
	};
	console.error = (...args) => emit(red('[fw] ') + fmt(args), 'err');
}
