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
	}
};

let _cached = null;

/**
 * @param {{allowMissing?: boolean}} [opts]
 * @returns {{server: object, account: {login: string}}}
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
		account: Object.assign({}, DEFAULTS.account, raw.account)
	};

	if (!_cached.server.packetver) {
		throw new Error(CONFIG_FILE + ': server.packetver is required (client date, e.g. 20211103)');
	}

	return _cached;
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
function rawPrompt(label, opts = {}) {
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
					if (!mask) {
						stdout.write('\b \b');
					}
				}
			} else {
				buf += ch;
				if (!mask) {
					stdout.write(ch);
				}
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
