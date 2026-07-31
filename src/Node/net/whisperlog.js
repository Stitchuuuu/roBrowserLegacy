/**
 * Node/net/whisperlog.js
 *
 * Persistent sink for received whispers — one JSON line per message, so a
 * whisper is never missed while the client runs unattended, even outside
 * the REPL's scrollback. Colocated with the debug trace under `node-logs/`
 * (see debuglog.js:66 for the same `path.resolve(process.cwd(), 'node-logs')`
 * convention).
 *
 * Reads from `RoClient`'s `privateMessage` event ({ sender, msg }, emitted by
 * api/messages.js off ZC.WHISPER/WHISPER2) — no packet tap of its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

let stream = null;

function open() {
	if (stream) {
		return;
	}
	const dir = path.resolve(process.cwd(), 'node-logs');
	fs.mkdirSync(dir, { recursive: true });
	stream = fs.createWriteStream(path.join(dir, 'whispers.log'), { flags: 'a' });
}

/**
 * @param {{sender: string, msg: string}} whisper
 */
export function logWhisper(whisper) {
	open();
	const rec = { ts: new Date().toISOString(), from: whisper.sender, text: whisper.msg };
	stream.write(JSON.stringify(rec) + '\n');
}
