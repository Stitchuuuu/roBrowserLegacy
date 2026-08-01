/**
 * Node/macro/stopfile.js
 *
 * Out-of-band kill switch for an unattended run: when <cwd>/.ro-node-stop
 * appears, abort the running macro and delete the file so the drop is
 * immediately re-armable.
 *
 *   echo > .ro-node-stop      # from the directory the client was launched in
 *
 * Watches the PARENT directory, never the file — the file does not exist most
 * of the time, and a watch on a path that gets removed dies (the reason
 * .devcontainer/notify/lib/inbound-watch.js watches the parent too). node-logs/
 * would be the wrong parent: it receives a write per packet, so the watch would
 * fire thousands of times a minute.
 *
 * A drop fires one or two change events (create, then write). Unlinking BEFORE
 * calling back makes the second one find nothing and return, so no debounce is
 * needed — and the drop stays re-armable even if the callback throws. fs.watch
 * failing is never fatal: the switch just stays off, like the notify watchers.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { log } from '../log.js';

const FILE = '.ro-node-stop';

/** Absolute drop-file path, anchored on the launch cwd (like .ro-node-history). */
export function stopFilePath() {
	return path.resolve(process.cwd(), FILE);
}

/**
 * Arm the watcher. Called once at REPL boot — not at /run time: the point is
 * killing a macro from outside a detached terminal, so a switch that only exists
 * while a macro runs would both miss a file dropped a second early and leave it
 * on disk to fire the next run spuriously.
 *
 * @param {function(): void} onDrop fired once per dropped file
 * @returns {?import('node:fs').FSWatcher} null when watching is unavailable
 */
export function watchStopFile(onDrop) {
	const file = stopFilePath();
	const dir = path.dirname(file);
	const base = path.basename(file);

	// A file left over from a crash must not fire this run.
	try {
		fs.rmSync(file, { force: true });
	} catch (err) {
		log.warn('stop file: cannot clear ' + file + ' — ' + err.message);
	}

	let watcher;
	try {
		watcher = fs.watch(dir, (_event, name) => {
			if (name !== base || !fs.existsSync(file)) {
				return;
			}
			try {
				fs.rmSync(file, { force: true });
			} catch (err) {
				log.warn('stop file: cannot remove ' + file + ' — ' + err.message);
			}
			log.event('stop file dropped — aborting macro');
			onDrop();
		});
	} catch (err) {
		log.warn('stop file: cannot watch ' + dir + ' — ' + err.message + ' (file-drop stop disabled)');
		return null;
	}

	watcher.unref(); // never hold the process open
	log.info('stop file armed: ' + file);
	return watcher;
}
