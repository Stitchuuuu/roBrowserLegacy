/**
 * Node/cli/registry.js
 *
 * Slash-command table: name (+ aliases) → command module. Each command is
 * `{ name, aliases?, usage?, help, run(ctx, args) }` and consumes the RoClient
 * façade via ctx — no packet code lives here.
 */
import login from './commands/login.js';
import logout from './commands/logout.js';
import charselect from './commands/charselect.js';
import status from './commands/status.js';
import party from './commands/party.js';
import skills from './commands/skills.js';
import skill from './commands/skill.js';
import buffs from './commands/buffs.js';
import entities from './commands/entities.js';
import inventory from './commands/inventory.js';
import say from './commands/say.js';
import whisper from './commands/whisper.js';
import emote from './commands/emote.js';
import move from './commands/move.js';
import npc from './commands/npc.js';
import useitem from './commands/useitem.js';
import groundskill from './commands/groundskill.js';
import storage from './commands/storage.js';
import autobuff from './commands/autobuff.js';
import autoheal from './commands/autoheal.js';
import homunbuff from './commands/homunbuff.js';
import macro from './commands/macro.js';
import routine from './commands/routine.js';
import run from './commands/run.js';
import stop from './commands/stop.js';
import help from './commands/help.js';

const COMMANDS = [
	login,
	logout,
	charselect,
	status,
	party,
	skills,
	skill,
	buffs,
	entities,
	inventory,
	say,
	whisper,
	emote,
	move,
	npc,
	useitem,
	groundskill,
	storage,
	autobuff,
	autoheal,
	homunbuff,
	macro,
	routine,
	run,
	stop,
	help
];

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
