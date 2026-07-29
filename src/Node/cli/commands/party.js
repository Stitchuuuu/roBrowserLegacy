/**
 * /party — party roster (name, ids, HP, online).
 */
import Session from 'Engine/SessionStorage.js';
import { log } from '../../log.js';

export default {
	name: 'party',
	aliases: ['p'],
	help: 'show the party roster',
	run(ctx) {
		const client = ctx.client;
		const members = client.getParty();
		if (!members.length) {
			log.event('no party');
			return;
		}
		// The server sends NOTIFY_HP_TO_GROUPM only for OTHER members — our own
		// HP lives in PlayerState, so the self entry reads 0/0. Overlay it here.
		const selfAid = Session.AID;
		const player = client.player;
		log.event(members.length + ' member(s):');
		for (let i = 0, n = members.length; i < n; ++i) {
			const m = members[i];
			const hp = m.aid === selfAid ? player.hp : m.hp;
			const maxhp = m.aid === selfAid ? player.maxhp : m.maxhp;
			log.event(
				'  ' +
					m.name +
					'  · aid ' +
					m.aid +
					' · gid ' +
					m.gid +
					' · hp ' +
					hp +
					'/' +
					maxhp +
					(m.online ? '' : ' · offline')
			);
		}
	}
};
