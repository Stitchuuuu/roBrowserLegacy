/**
 * /move <x> <y> — walk to a map cell.
 */
import { log } from '../../log.js';

export default {
	name: 'move',
	usage: '<x> <y>',
	help: 'walk to a map cell',
	run(ctx, args) {
		if (args.length < 2) {
			log.event('usage: /move <x> <y>');
			return;
		}
		const x = Number(args[0]);
		const y = Number(args[1]);
		if (Number.isNaN(x) || Number.isNaN(y)) {
			log.event('move: x and y must be numbers');
			return;
		}
		const res = ctx.client.player.moveTo(x, y);
		if (res && res.sent) {
			log.event('move → ' + x + ',' + y);
		} else {
			log.event('move skipped: ' + (res && res.reason));
		}
	}
};
