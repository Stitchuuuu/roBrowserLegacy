/**
 * /status — own HP / SP / zeny / weight / position.
 */
import { log } from '../../log.js';

export default {
	name: 'status',
	aliases: ['st'],
	help: 'show your HP/SP/zeny/weight/position',
	run(ctx) {
		const p = ctx.client.player;
		log.event((p.name || '?') + '  ·  map ' + (ctx.client.currentMap || '?'));
		log.event(
			'HP ' +
				p.hp +
				'/' +
				p.maxhp +
				'  ·  SP ' +
				p.sp +
				'/' +
				p.maxsp +
				'  ·  zeny ' +
				p.zeny +
				'  ·  weight ' +
				p.weight +
				'/' +
				p.maxweight +
				'  ·  pos ' +
				(p.x || p.y ? p.x + ',' + p.y : '?')
		);
	}
};
