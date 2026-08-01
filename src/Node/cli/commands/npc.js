/**
 * /npc talk <naid> | next | choose <i> | close | num <v> | str <text>
 * — drive the current NPC dialog. talk needs a NAID (no in-client NPC lookup);
 * discover one from node-logs/ or an observeAny tap.
 */
import { log } from '../../log.js';

function report(action, res) {
	if (res && res.sent) {
		log.event('npc ' + action + ' sent');
	} else {
		log.event('npc ' + action + ' refused: ' + (res && res.reason));
	}
}

export default {
	name: 'npc',
	usage: 'talk <naid> | next | choose <i> | close | num <v> | str <text>',
	help: 'drive the current NPC dialog',
	run(ctx, args) {
		const npc = ctx.client.npc;
		const sub = args[0];
		switch (sub) {
			case 'talk': {
				const naid = Number(args[1]);
				if (Number.isNaN(naid)) {
					log.event('usage: /npc talk <naid>');
					return;
				}
				report('talk', npc.talk(naid));
				return;
			}
			case 'next':
				report('next', npc.next());
				return;
			case 'choose': {
				const i = Number(args[1]);
				if (Number.isNaN(i)) {
					log.event('usage: /npc choose <index> (255 = cancel)');
					return;
				}
				report('choose ' + i, npc.choose(i));
				return;
			}
			case 'close':
				report('close', npc.close());
				return;
			case 'num': {
				const v = Number(args[1]);
				if (Number.isNaN(v)) {
					log.event('usage: /npc num <value>');
					return;
				}
				report('num ' + v, npc.inputNum(v));
				return;
			}
			case 'str':
				report('str', npc.inputStr(args.slice(1).join(' ')));
				return;
			default:
				log.event('usage: /npc talk <naid> | next | choose <i> | close | num <v> | str <text>');
		}
	}
};
