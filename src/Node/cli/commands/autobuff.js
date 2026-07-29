/**
 * /autobuff <profile|skills…> | stop
 *
 * Forms:
 *  - /autobuff stop                  → stop the routine (session stays in map).
 *  - /autobuff <profile>             → start a saved per-character profile.
 *  - /autobuff <skill> [skill…]      → start an inline list; saved as profile
 *                                       "last" for the current character.
 *  - /autobuff <name> <skill> [skill…] → define+save profile <name>, then start.
 *  - /autobuff emote <token|off>       → set the beg emote (a party member plays
 *                                         it to force their buffs; default /mp).
 *  - /autobuff emote                    → show the current beg emote.
 *
 * Profiles are stored per character (config.characters["<login>/<slot>"].autobuff).
 */
import Emotions from 'DB/Emotions.js';
import { resolveSkill } from '../../resolve/skills.js';
import { saveConfig, charKey } from '../../config.js';
import { log } from '../../log.js';

export default {
	name: 'autobuff',
	aliases: ['ab'],
	usage: '<profile|skills…> | emote <token|off> | stop',
	help: 'maintain buffs (named profile or inline skills)',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /autobuff <profile|skills…> | stop');
			return;
		}
		if (args[0] === 'stop') {
			log.event(ctx.session.stopRoutine('autobuff') ? 'autobuff stopped' : 'autobuff was not running');
			return;
		}

		const cfg = ctx.config;
		const key = charKey(cfg);

		// /autobuff emote [token|off] — the emote a party member plays to beg
		// their buffs (default /mp). No token → show the current setting.
		if (args[0] === 'emote') {
			const chr = cfg.characters && cfg.characters[key];
			if (args.length < 2) {
				const cur = chr && chr.autobuffEmote;
				const shown = cur === 'off' || cur === false ? 'off' : cur == null ? 'mp (default)' : cur;
				log.event('autobuff beg emote: ' + shown);
				return;
			}
			const token = args[1];
			const off = token === 'off';
			if (!off && Emotions.commands[token] == null) {
				log.event('unknown emote "' + token + '" — e.g. mp, no1, hlp');
				return;
			}
			saveConfig({ characters: { [key]: { autobuffEmote: off ? 'off' : token } } });
			const routine = ctx.session.getRoutine('autobuff');
			const live = routine && routine.setTriggerEmote ? routine.setTriggerEmote(off ? 'off' : token) : null;
			log.event('autobuff beg emote set to ' + (off ? 'off' : '/' + token) + (live && live.ok ? ' (live)' : ''));
			return;
		}

		const profiles = (cfg.characters && cfg.characters[key] && cfg.characters[key].autobuff) || {};

		let name;
		let skills;
		if (resolveSkill(args[0])) {
			// inline skill list → persist under "last"
			name = 'last';
			skills = args;
		} else if (args.length === 1) {
			// single non-skill token → must be an existing profile
			if (!Array.isArray(profiles[args[0]])) {
				log.event('no profile "' + args[0] + '" and not a skill — /autobuff <skills…>');
				return;
			}
			name = args[0];
			skills = profiles[args[0]];
		} else {
			// first token is a new profile name, rest are skills
			name = args[0];
			skills = args.slice(1);
		}

		// Persist unless we're just launching an already-saved profile unchanged.
		const isExistingProfile = Array.isArray(profiles[name]) && profiles[name].join(' ') === skills.join(' ');
		if (!isExistingProfile) {
			saveConfig({ characters: { [key]: { autobuff: { [name]: skills } } } });
			log.event('saved autobuff profile "' + name + '" (' + skills.join(', ') + ') for ' + key);
		}

		const res = ctx.session.startRoutine('autobuff', skills, ctx);
		if (!res.ok) {
			log.event(res.reason);
		}
	}
};
