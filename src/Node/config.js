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
 * Masked interactive password prompt (no echo — raw mode, char by char).
 *
 * @returns {Promise<string>}
 */
function promptPassword() {
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		const stdout = process.stdout;
		let pass = '';

		stdout.write('Password: ');
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
				resolve(pass);
			} else if (ch === '\u0003') {
				// Ctrl-C
				cleanup();
				stdout.write('\n');
				reject(new Error('password prompt aborted'));
			} else if (ch === '\u007f' || ch === '\b') {
				pass = pass.slice(0, -1);
			} else {
				pass += ch;
			}
		}

		stdin.on('data', onData);
	});
}

/**
 * Resolve the account password: `--pass=<value>` argv, then RO_PASS env,
 * then a masked interactive prompt when stdin is a TTY. RAM only — never
 * persisted, never echoed.
 *
 * @returns {Promise<string>}
 */
export async function resolvePassword() {
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
		const pass = await promptPassword();
		if (pass) {
			return pass;
		}
	}

	throw new Error('no password — interactive prompt needs a TTY; otherwise use RO_PASS env or --pass=<value>');
}
