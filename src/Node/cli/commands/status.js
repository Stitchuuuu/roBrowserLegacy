/**
 * /status — own HP / SP / zeny / weight.
 */
import { log } from '../../log.js';

export default {
	name: 'status',
	aliases: ['st'],
	help: 'show your HP/SP/zeny/weight',
	run(ctx) {
		const p = ctx.client.player;
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
				p.maxweight
		);
	}
};
