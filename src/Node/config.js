/**
 * Node/config.js
 *
 * Loads config.local.json (repo root, gitignored). Imports node builtins
 * only — this module must stay importable by shim.js before any core
 * (Network/Core/Utils) module is loaded.
 *
 * The account password is NEVER read from, or written to, this file:
 * it comes from `--pass=<value>` argv or the RO_PASS env var, RAM only.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CONFIG_FILE = 'config.local.json';

/**
 * Defaults used when the file is absent and { allowMissing } is set
 * (smoke build check — no server contact, values only need to let the
 * module graph load).
 */
const DEFAULTS = {
	server: {
		host: '127.0.0.1',
		port: 6900,
		version: 55,
		langtype: 0,
		packetver: 0,
		renewal: false,
		packetKeys: false,
		charSlot: 0,
		wsProxy: null,
		packetDump: false
	},
	account: {
		login: ''
	},
	// Per-character state, keyed "<login>/<charSlot>". Each entry holds the
	// character name and its own routine config (autobuff / autoheal / homunbuff
	// profiles — homunbuff carries { skills, own, party, radius, spFloor,
	// durations }, the last a per-skill ms override of the pre-renewal table in
	// resolve/buffMap.js) — a routine
	// runs on a specific character, so its config is scoped here, not global.
	characters: {}
};

let _cached = null;

/**
 * @param {{allowMissing?: boolean}} [opts]
 * @returns {{server: object, account: {login: string}, characters: object}}
 */
export function loadConfig(opts = {}) {
	if (_cached) {
		return _cached;
	}

	const file = path.resolve(process.cwd(), CONFIG_FILE);

	if (!fs.existsSync(file)) {
		if (opts.allowMissing) {
			return (_cached = DEFAULTS);
		}
		throw new Error(CONFIG_FILE + ' not found at ' + file + ' — create it (see src/Node/config.js schema)');
	}

	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	_cached = {
		server: Object.assign({}, DEFAULTS.server, raw.server),
		account: Object.assign({}, DEFAULTS.account, raw.account),
		characters: raw.characters && typeof raw.characters === 'object' ? raw.characters : {}
	};

	if (!_cached.server.packetver) {
		throw new Error(CONFIG_FILE + ': server.packetver is required (client date, e.g. 20211103)');
	}

	return _cached;
}

/**
 * Identity of the character a routine binds to: account login + char slot.
 * @param {{account:{login:string}, server:{charSlot:number}}} cfg
 * @returns {string} "<login>/<slot>"
 */
export function charKey(cfg) {
	const login = (cfg && cfg.account && cfg.account.login) || '';
	const slot = cfg && cfg.server ? cfg.server.charSlot : 0;
	return login + '/' + slot;
}

const SECRET_KEYS = { password: 1, passwd: 1, pass: 1 };

function stripSecrets(value) {
	if (!value || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(stripSecrets);
	}
	const out = {};
	for (const k in value) {
		if (SECRET_KEYS[k.toLowerCase()]) {
			continue;
		}
		out[k] = stripSecrets(value[k]);
	}
	return out;
}

// Recursive merge: plain objects merge key-by-key; arrays and primitives
// replace. Creates missing nested objects on the target.
function deepMerge(target, patch) {
	for (const k in patch) {
		const pv = patch[k];
		if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
			if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) {
				target[k] = {};
			}
			deepMerge(target[k], pv);
		} else {
			target[k] = pv;
		}
	}
	return target;
}

/**
 * Persist a partial config into config.local.json (gitignored). Reads the raw
 * file fresh (not the DEFAULTS-filtered cache), deep-merges the patch so
 * unknown keys are preserved, then refreshes the in-memory cache so the running
 * process sees the change without a reload. The password is NEVER written —
 * any password/passwd/pass key in the patch is stripped defensively.
 *
 * @param {object} patch partial config to merge
 * @returns {object} the full merged config now on disk
 */
export function saveConfig(patch) {
	const file = path.resolve(process.cwd(), CONFIG_FILE);
	let raw = {};
	if (fs.existsSync(file)) {
		try {
			raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch {
			raw = {};
		}
	}

	const clean = stripSecrets(patch);
	deepMerge(raw, clean);
	fs.writeFileSync(file, JSON.stringify(raw, null, '\t') + '\n', 'utf8');

	// Keep the live cfg in sync (never persisted secrets are also absent here).
	if (_cached && _cached !== DEFAULTS) {
		deepMerge(_cached, clean);
	}
	return raw;
}

/**
 * Single-line raw-mode prompt. `mask` hides the input (password). Resolves
 * with a discriminated result so the caller can tell Enter / Ctrl-C / Ctrl-D
 * apart rather than throwing — Ctrl-C at a password prompt is a "go back",
 * not an abort.
 *
 * @param {string} label prompt text
 * @param {{mask?: boolean}} [opts]
 * @returns {Promise<{value?: string, interrupted?: boolean, eof?: boolean}>}
 */
export function rawPrompt(label, opts = {}) {
	const mask = !!opts.mask;
	return new Promise(resolve => {
		const stdin = process.stdin;
		const stdout = process.stdout;
		let buf = '';

		stdout.write(label);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');

		function cleanup() {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.removeListener('data', onData);
		}

		function onData(ch) {
			if (ch === '\r' || ch === '\n') {
				cleanup();
				stdout.write('\n');
				resolve({ value: buf });
			} else if (ch === '\u0003') {
				// Ctrl-C — caller decides what to do (go back to login here)
				cleanup();
				stdout.write('\n');
				resolve({ interrupted: true });
			} else if (ch === '\u0004') {
				// Ctrl-D (EOF)
				cleanup();
				stdout.write('\n');
				resolve({ eof: true });
			} else if (ch === '\u007f' || ch === '\b') {
				if (buf.length) {
					buf = buf.slice(0, -1);
					stdout.write('\b \b');
				}
			} else {
				buf += ch;
				stdout.write(mask ? '*'.repeat(ch.length) : ch);
			}
		}

		stdin.on('data', onData);
	});
}

/**
 * Interactive credential prompt: masked password, and — on Ctrl-C during the
 * password — a "go back" that re-asks the account login (editable, defaults
 * to the current one) before prompting the password again. Ctrl-C at the
 * login prompt (or Ctrl-D anywhere) aborts for good. The re-entered login is
 * applied to `cfg.account.login` in memory (never persisted here).
 *
 * @param {{account: {login: string}}} cfg
 * @returns {Promise<string>} the password (RAM only)
 */
async function promptCredentials(cfg) {
	const account = cfg && cfg.account ? cfg.account : { login: '' };
	for (;;) {
		const pw = await rawPrompt('Password: ', { mask: true });
		if (pw.eof) {
			throw new Error('password prompt aborted (EOF)');
		}
		if (!pw.interrupted) {
			if (pw.value) {
				return pw.value;
			}
			process.stdout.write('(empty password — try again)\n');
			continue;
		}

		// Ctrl-C during the password → re-enter the login, then loop back.
		const current = account.login || '';
		const li = await rawPrompt('Login [' + current + ']: ');
		if (li.interrupted || li.eof) {
			throw new Error('login prompt aborted');
		}
		account.login = (li.value || '').trim() || current;
		process.stdout.write('account: ' + account.login + '\n');
	}
}

/**
 * Resolve the account password: `--pass=<value>` argv, then RO_PASS env, then
 * an interactive masked prompt when stdin is a TTY. RAM only — never
 * persisted, never echoed. During the interactive prompt, Ctrl-C re-asks the
 * login instead of aborting (see promptCredentials).
 *
 * @param {{account: {login: string}}} [cfg] enables the login "go back"
 * @returns {Promise<string>}
 */
export async function resolvePassword(cfg) {
	const argv = process.argv;
	for (let i = 2, count = argv.length; i < count; ++i) {
		if (argv[i].startsWith('--pass=')) {
			return argv[i].slice('--pass='.length);
		}
	}

	const env = process.env.RO_PASS;
	if (env) {
		return env;
	}

	if (process.stdin.isTTY) {
		return promptCredentials(cfg);
	}

	throw new Error('no password — interactive prompt needs a TTY; otherwise use RO_PASS env or --pass=<value>');
}
