/**
 * /useitem <index|itemId|name> — use a consumable from inventory.
 */
import { log } from '../../log.js';

export default {
	name: 'useitem',
	usage: '<index|itemId|name>',
	help: 'use a consumable (by slot index, item id, or best-effort name)',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /useitem <index|itemId|name>  (see /inventory)');
			return;
		}
		// A number is a slot index or item id (use() tries both); else a name.
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
