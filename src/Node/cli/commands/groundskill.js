/**
 * /groundskill <name> <x> <y> [level] — cast a ground-targeted skill at a cell.
 */
import { log } from '../../log.js';

export default {
	name: 'groundskill',
	usage: '<name> <x> <y> [level]',
	help: 'cast a ground-targeted skill at a map cell',
	run(ctx, args) {
		if (args.length < 3) {
			log.event('usage: /groundskill <name> <x> <y> [level]');
			return;
		}
		const name = args[0];
		const x = Number(args[1]);
		const y = Number(args[2]);
		const level = args[3] != null ? Number(args[3]) : undefined;
		if (Number.isNaN(x) || Number.isNaN(y)) {
			log.event('groundskill: x and y must be numbers');
			return;
		}
		const res = ctx.client.skill.castGround(name, x, y, level);
		if (res && res.sent) {
			log.event('groundcast ' + name + ' → ' + x + ',' + y);
		} else {
			log.event('groundcast failed: ' + (res && res.reason));
		}
	}
};
