/**
 * /buffs [target|aid] — active status effects (EFST).
 *
 * No arg → self + every party member. A target may be a member name (spaces
 * allowed) or a raw AID. NB: a member's effects are only visible while they are
 * on-screen (the server sends their status then).
 */
import Session from 'Engine/SessionStorage.js';
import StatusInfo from 'DB/Status/StatusInfo.js';
import { log } from '../../log.js';

function efstName(efst) {
	const info = StatusInfo[efst];
	if (info && info.descript && info.descript[0] && info.descript[0][0]) {
		return info.descript[0][0];
	}
	return 'EFST ' + efst;
}

export default {
	name: 'buffs',
	aliases: ['buff'],
	usage: '[target|aid]',
	help: 'active status effects (self + party, or a target)',
	run(ctx, args) {
		const status = ctx.client.party.getStatusState();
		const now = Date.now();

		const show = who => {
			const bucket = status.get(who.aid);
			const lines = [];
			if (bucket) {
				for (const efst in bucket) {
					const e = bucket[efst];
					if (!e.active) {
						continue;
					}
					const left = e.end ? Math.max(0, Math.round((e.end - now) / 1000)) + 's' : '∞';
					lines.push('  ' + efstName(Number(efst)) + ' (' + left + ')');
				}
			}
			if (!lines.length) {
				log.event(who.label + ': no active buffs');
				return;
			}
			log.event(who.label + ':');
			for (let i = 0; i < lines.length; ++i) {
				log.event(lines[i]);
			}
		};

		const target = args.length ? args.join(' ').trim() : '';

		if (!target) {
			// self + every party member
			show({ aid: Session.AID, label: 'you' });
			const members = ctx.client.getParty();
			for (let i = 0, n = members.length; i < n; ++i) {
				const m = members[i];
				if (m.aid !== Session.AID) {
					show({ aid: m.aid, label: m.name + (m.online ? '' : ' (offline)') });
				}
			}
			return;
		}

		if (target === 'me' || target === 'self') {
			show({ aid: Session.AID, label: 'you' });
			return;
		}
		if (/^\d+$/.test(target)) {
			show({ aid: Number(target), label: 'aid ' + target });
			return;
		}

		const member = ctx.client.party.get(target);
		if (!member) {
			log.event('unknown target "' + target + '"');
			return;
		}
		show({ aid: member.aid, label: member.name });
	}
};
