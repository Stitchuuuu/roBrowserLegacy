/**
 * /inventory — list held items (index, item id, count, type).
 *
 * Names are unavailable headless (DB.getItemInfo pulls browser-only deps), so
 * rows show the raw itid — the `index` is what `/useitem <index>` expects.
 */
import { log } from '../../log.js';

export default {
	name: 'inventory',
	aliases: ['inv'],
	help: 'list held items (index feeds /useitem)',
	run(ctx) {
		const items = ctx.client.inventory.list();
		if (!items.length) {
			log.event('inventory empty');
			return;
		}

		items.sort((a, b) => a.index - b.index);
		log.event(items.length + ' item(s) (names unavailable headless):');
		for (let i = 0, n = items.length; i < n; ++i) {
			const it = items[i];
			log.event('  index ' + it.index + '  itid ' + it.itid + ' ×' + it.count + ' · type ' + it.type);
		}
	}
};
