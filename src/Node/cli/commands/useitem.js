/**
 * /useitem <index|name> — use a consumable from inventory.
 */
import { log } from '../../log.js';

export default {
	name: 'useitem',
	usage: '<index|name>',
	help: 'use a consumable from inventory (by slot index or best-effort name)',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /useitem <index|name>');
			return;
		}
		// A numeric token is a slot index; anything else is a (best-effort) name.
		const arg = args.join(' ');
		const n = Number(arg);
		const target = Number.isNaN(n) ? arg : n;
		const res = ctx.client.inventory.use(target);
		if (res && res.sent) {
			log.event('useitem → slot ' + res.index);
		} else {
			log.event('useitem refused: ' + (res && res.reason));
		}
	}
};
