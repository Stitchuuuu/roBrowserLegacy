/**
 * Node/net/notify.js
 *
 * Desktop alerts for the unattended headless client, via the standalone
 * `notif` CLI binary (NOT the notify daemon/queue — this shells out to the
 * binary directly, one-shot per alert). Invocation learned from
 * `.devcontainer/notify/lib/consumers/notify-app.js`:
 *   - `getNotifPath()` → binary resolution order (below).
 *   - `registerClaudeCodeSender()` → the idempotent `notif register` step,
 *     here for a "ragnarok" sender instead of "claude-code".
 *   - `spawnFireAndForget()` → detached + unref'd, NOTIF_QUIET=1, errors
 *     swallowed — a failed notif dispatch must never crash the client.
 *
 * The binary is host-only (macOS today) — this container has none, so on
 * every dispatch here we degrade to a log line + REPL bell. Every alert,
 * dispatched or degraded, also lands in node-logs/alerts.log so nothing is
 * silently lost.
 *
 * Ragnarok icon: no .icns exists yet (TODO — convert a client asset, see
 * ROLLOUT.md's cross-cutting concern section). `register()` omits --icon
 * when the candidate path is absent; the sender still works, default bell
 * icon.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { log } from '../log.js';

const SENDER = 'ragnarok';
const SENDER_NAME = 'Ragnarok';
// Candidate — not yet produced/verified; register() no-ops --icon if absent.
const ICON_PATH = path.resolve(process.cwd(), 'assets', 'ro.icns');

let notifBinPath; // undefined = not yet resolved, null = resolved to "none"
let registered = false;
let alertStream = null;
let nextId = 1;

/**
 * Resolve the `notif` binary path, in priority order: NOTIF_BIN env →
 * ~/.local/bin/notif → ~/bin/notif → /usr/local/bin/notif →
 * /opt/homebrew/bin/notif → PATH scan. Cached after the first call.
 * @returns {?string}
 */
export function getNotifPath() {
	if (notifBinPath !== undefined) {
		return notifBinPath;
	}
	const candidates = [
		process.env.NOTIF_BIN,
		path.join(os.homedir(), '.local', 'bin', 'notif'),
		path.join(os.homedir(), 'bin', 'notif'),
		'/usr/local/bin/notif',
		'/opt/homebrew/bin/notif'
	];
	for (const p of candidates) {
		if (p && fs.existsSync(p)) {
			notifBinPath = p;
			return notifBinPath;
		}
	}
	const PATH = process.env.PATH || '';
	for (const dir of PATH.split(path.delimiter)) {
		if (!dir) {
			continue;
		}
		const candidate = path.join(dir, 'notif');
		if (fs.existsSync(candidate)) {
			notifBinPath = candidate;
			return notifBinPath;
		}
	}
	notifBinPath = null;
	return null;
}

function openAlertLog() {
	if (alertStream) {
		return;
	}
	const dir = path.resolve(process.cwd(), 'node-logs');
	fs.mkdirSync(dir, { recursive: true });
	alertStream = fs.createWriteStream(path.join(dir, 'alerts.log'), { flags: 'a' });
}

function mirrorToLog(kind, title, body) {
	openAlertLog();
	const rec = { ts: new Date().toISOString(), kind, title, body };
	alertStream.write(JSON.stringify(rec) + '\n');
}

function spawnFireAndForget(bin, args) {
	try {
		const child = spawn(bin, args, { detached: true, stdio: 'ignore', env: { ...process.env, NOTIF_QUIET: '1' } });
		child.unref();
		child.on('error', e => log.warn('[notify]', bin, 'failed:', e.message));
	} catch (e) {
		log.warn('[notify] spawn', bin, 'threw:', e.message);
	}
}

// Idempotent — safe to call before every alert (no-ops after the first).
function register() {
	if (registered) {
		return;
	}
	registered = true;
	const bin = getNotifPath();
	if (!bin) {
		return;
	}
	const args = ['register', '--sender', SENDER, '--name', SENDER_NAME];
	if (fs.existsSync(ICON_PATH)) {
		args.push('--icon', ICON_PATH);
	}
	spawnFireAndForget(bin, args);
}

/**
 * Fire a desktop alert: whisper received / player crossed the zone. Degrades
 * to a log line + REPL bell when no `notif` binary is reachable (e.g. inside
 * this Linux container). Never throws.
 *
 * @param {{title: string, body: string, subtitle?: string}} opts
 */
export function alert(opts) {
	const { title, body, subtitle } = opts;
	mirrorToLog('alert', title, body);

	const bin = getNotifPath();
	if (!bin) {
		log.warn('[notify] no notif binary — bell + alerts.log only:', title, '—', body);
		process.stdout.write('\x07');
		return;
	}

	register();
	const args = ['send', '--sender', SENDER, '--id', String(nextId++), '--title', title, '--body', body];
	if (subtitle) {
		args.push('--subtitle', subtitle);
	}
	spawnFireAndForget(bin, args);
}
