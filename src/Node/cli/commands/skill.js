/**
 * /skill <name> [target] — cast a skill (target defaults to self).
 */
import { log } from '../../log.js';

export default {
	name: 'skill',
	usage: '<name> [target]',
	help: 'cast a skill on a target (default self)',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /skill <name> [target]');
			return;
		}
		const name = args[0];
		// Target is the rest of the line joined — a party member name can carry
		// spaces ("Gemini no Rei"); the REPL split it into tokens. Skill names use
		// single-token aliases (heal, incagi…), so args[0] alone is the skill.
		const target = args.slice(1).join(' ') || 'me';
		const res = ctx.client.doSkill(name, target);
		if (res && res.sent) {
			log.event('cast ' + name + ' → ' + target + (res.caveat ? ' (' + res.caveat + ')' : ''));
		} else {
			log.event('cast failed: ' + (res && res.reason));
		}
	}
};
