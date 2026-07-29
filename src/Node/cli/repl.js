/**
 * Node/cli/repl.js
 *
 * Wires the screen's line events to the command registry. Builds the ctx handed
 * to every command and dispatches `/cmd args`. Bare (non-slash) input gets a
 * hint; unknown commands point at /help.
 */
import { getCommand, commandList } from './registry.js';
import { logInput, logCommand } from '../debuglog.js';
import { log } from '../log.js';

/**
 * @param {{screen, session, client, config}} deps
 * @returns {object} ctx (also returned for direct-launch reuse)
 */
export function startRepl(deps) {
	const ctx = {
		screen: deps.screen,
		session: deps.session,
		client: deps.client,
		config: deps.config,
		log,
		getCommand,
		commandList
	};

	deps.screen.onLine(async line => {
		logInput(line); // raw line as typed (input vs executed command)
		if (!line) {
			return;
		}
		if (line[0] !== '/') {
			logCommand(line, [], { reason: 'not-a-command' });
			log.event('commands start with "/" — try /help');
			return;
		}
		const parts = line.slice(1).split(/\s+/);
		const name = parts.shift();
		const cmd = getCommand(name);
		if (!cmd) {
			logCommand(name, parts, { resolved: null, reason: 'unknown' });
			log.event('unknown command "/' + name + '" — /help');
			return;
		}
		logCommand(name, parts, { resolved: cmd.name });
		try {
			await cmd.run(ctx, parts);
		} catch (err) {
			log.error('/' + name + ': ' + err.message);
		}
	});

	return ctx;
}
