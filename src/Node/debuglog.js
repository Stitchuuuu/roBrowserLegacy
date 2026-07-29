/**
 * Node/debuglog.js
 *
 * Full-session debug trace to a file (node-logs/session-<ts>.log, gitignored),
 * one JSON record per line. Captures, timestamped, everything needed to replay
 * the behaviour end to end:
 *   - recv : every inbound packet (name + opcode + decoded fields)
 *   - send : every outbound packet EXCEPT CA.LOGIN (never log the password)
 *   - cmd  : each REPL command line
 *   - log  : every human log line (events / routine / framework), ANSI-stripped
 *
 * Enabled by default for now (see index.js). Imports node builtins + Network
 * only; observeAny provides the inbound catch-all.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import { observeAny } from './net/observe.js';

let stream = null;
let filePath = null;

// BigInt (int64 packet fields) isn't JSON-serialisable; also belt-and-suspenders
// redaction of any stray credential field.
function jsonReplacer(key, value) {
	if (typeof value === 'bigint') {
		return Number(value);
	}
	if (key === 'Passwd' || key === 'password' || key === 'pass') {
		return '***';
	}
	return value;
}

function write(kind, label, data, extra) {
	if (!stream) {
		return;
	}
	const now = Date.now();
	// Every record carries both an epoch ms (sortable) and an ISO time (human).
	const rec = { t: now, ts: new Date(now).toISOString(), kind, label };
	if (extra) {
		Object.assign(rec, extra);
	}
	if (data !== undefined && data !== null) {
		rec.data = data;
	}
	try {
		stream.write(JSON.stringify(rec, jsonReplacer) + '\n');
	} catch {
		stream.write(
			JSON.stringify({ t: now, ts: new Date(now).toISOString(), kind, label, data: '[unserializable]' }) + '\n'
		);
	}
}

/**
 * Open the per-session log and install the packet taps. Idempotent.
 * @returns {string} absolute log-file path
 */
export function startDebugLog() {
	if (stream) {
		return filePath;
	}
	const dir = path.resolve(process.cwd(), 'node-logs');
	fs.mkdirSync(dir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	filePath = path.join(dir, 'session-' + ts + '.log');
	stream = fs.createWriteStream(filePath, { flags: 'a' });
	write('session', 'start');

	// inbound — every packet
	observeAny((id, name, instance) => {
		write('recv', (name || 'UNKNOWN') + '(0x' + id.toString(16) + ')', instance || undefined);
	});

	// outbound — everything except the login packet (never log the password)
	const origSend = Network.sendPacket.bind(Network);
	Network.sendPacket = function loggedSend(pkt) {
		const name = pkt && pkt.constructor && pkt.constructor.name;
		if (!name || !/^PACKET_CA_LOGIN/.test(name)) {
			write('send', name || 'unknown', pkt || undefined);
		}
		return origSend(pkt);
	};

	return filePath;
}

// Raw line as typed at the REPL (before parsing).
export function logInput(line) {
	write('input', line);
}

/**
 * The command actually dispatched — the resolved command name + parsed args,
 * so an "I ran X but it did Y" can be traced to input-vs-execution.
 * @param {string} name the command token entered
 * @param {string[]} args parsed args
 * @param {object} [extra] e.g. { resolved: 'autobuff' } or { reason: 'unknown' }
 */
export function logCommand(name, args, extra) {
	write('cmd', name, undefined, { args: args || [], ...(extra || {}) });
}

// Human log line (from the log sink) — with its channel; ANSI stripped.
export function logLine(channel, text) {
	// eslint-disable-next-line no-control-regex
	write('log', String(text).replace(/\x1b\[[0-9;]*m/g, ''), undefined, { channel });
}

export function getLogPath() {
	return filePath;
}
