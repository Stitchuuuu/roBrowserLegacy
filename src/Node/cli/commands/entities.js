/**
 * /entities [mob|pc|npc] — list nearby entities from the perception tracker.
 *
 * For an NPC the printed gid IS the NAID `/npc talk <naid>` expects — this is
 * the in-client NPC lookup (talk a kafra by discovering it here first).
 */
import { log } from '../../log.js';
import { TYPE_PC, TYPE_MOB, TYPE_NPC, TYPE_NPC2, TYPE_NPC_ABR, TYPE_NPC_BIONIC } from '../../state/entities.js';

// Category token → the objecttype set it covers.
const CATEGORIES = {
	pc: { [TYPE_PC]: 1 },
	mob: { [TYPE_MOB]: 1 },
	npc: { [TYPE_NPC]: 1, [TYPE_NPC2]: 1, [TYPE_NPC_ABR]: 1, [TYPE_NPC_BIONIC]: 1 }
};

function labelOf(objecttype) {
	if (objecttype === TYPE_PC) {
		return 'PC';
	}
	if (objecttype === TYPE_MOB) {
		return 'MOB';
	}
	return 'NPC';
}

export default {
	name: 'entities',
	aliases: ['ent'],
	usage: '[mob|pc|npc]',
	help: 'list nearby entities (npc gid = NAID for /npc talk)',
	run(ctx, args) {
		const filter = args[0] && CATEGORIES[args[0].toLowerCase()];
		if (args[0] && !filter) {
			log.event('usage: /entities [mob|pc|npc]');
			return;
		}

		const rows = ctx.client.entities.list().filter(e => !filter || filter[e.objecttype]);
		rows.sort((a, b) => a.objecttype - b.objecttype || a.gid - b.gid);

		if (!rows.length) {
			log.event('no entities in view');
			return;
		}

		log.event(rows.length + ' entit' + (rows.length === 1 ? 'y' : 'ies') + ':');
		for (let i = 0, n = rows.length; i < n; ++i) {
			const e = rows[i];
			log.event(
				'  gid ' +
					e.gid +
					'  ' +
					labelOf(e.objecttype) +
					(e.name ? ' "' + e.name + '"' : '') +
					' · ' +
					e.x +
					',' +
					e.y +
					' · job ' +
					e.job
			);
		}
	}
};
