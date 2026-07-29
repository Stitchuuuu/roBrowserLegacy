/**
 * Node/cli/registry.js
 *
 * Slash-command table: name (+ aliases) → command module. Each command is
 * `{ name, aliases?, usage?, help, run(ctx, args) }` and consumes the RoClient
 * façade via ctx — no packet code lives here.
 */
import login from './commands/login.js';
import logout from './commands/logout.js';
import status from './commands/status.js';
import party from './commands/party.js';
import skills from './commands/skills.js';
import skill from './commands/skill.js';
import buffs from './commands/buffs.js';
import say from './commands/say.js';
import whisper from './commands/whisper.js';
import emote from './commands/emote.js';
import autobuff from './commands/autobuff.js';
import routine from './commands/routine.js';
import help from './commands/help.js';

const COMMANDS = [login, logout, status, party, skills, skill, buffs, say, whisper, emote, autobuff, routine, help];

const byName = {};
for (let i = 0, n = COMMANDS.length; i < n; ++i) {
	const cmd = COMMANDS[i];
	byName[cmd.name] = cmd;
	const aliases = cmd.aliases || [];
	for (let a = 0, an = aliases.length; a < an; ++a) {
		byName[aliases[a]] = cmd;
	}
}

export function getCommand(name) {
	return byName[String(name).toLowerCase()] || null;
}

export function commandList() {
	return COMMANDS;
}
