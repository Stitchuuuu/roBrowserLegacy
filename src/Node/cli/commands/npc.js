/**
 * /npc talk <naid|name> | next | choose <i> | close | num <v> | str <text>
 * — drive the current NPC dialog. `talk` takes either the numeric NAID or an
 * NPC name resolved against the entity tracker (same list as /entities npc).
 */
import { log } from '../../log.js';
import { TYPE_NPC, TYPE_NPC2, TYPE_NPC_ABR, TYPE_NPC_BIONIC } from '../../state/entities.js';

const NPC_TYPES = { [TYPE_NPC]: 1, [TYPE_NPC2]: 1, [TYPE_NPC_ABR]: 1, [TYPE_NPC_BIONIC]: 1 };

// RO duplicate NPCs carry a hidden "#dupe" suffix and names may hold ^RRGGBB
// color codes — compare on the visible part only.
function npcDisplayName(raw) {
	const clean = raw.replace(/\^[0-9a-fA-F]{6}/g, '');
	const hash = clean.indexOf('#');
	return (hash === -1 ? clean : clean.slice(0, hash)).trim().toLowerCase();
}

// Resolve an NPC name to its gid (= NAID) via the entity tracker, or null.
function resolveNpcByName(client, name) {
	const want = name.toLowerCase();
	const ents = client.entities.list();
	for (let i = 0, n = ents.length; i < n; ++i) {
		const e = ents[i];
		if (NPC_TYPES[e.objecttype] && npcDisplayName(e.name) === want) {
			return e.gid;
		}
	}
	return null;
}

function report(action, res) {
	if (res && res.sent) {
		log.event('npc ' + action + ' sent');
	} else {
		log.event('npc ' + action + ' refused: ' + (res && res.reason));
	}
}

export default {
	name: 'npc',
	usage: 'talk <naid|name> | next | choose <i> | close | num <v> | str <text>',
	help: 'drive the current NPC dialog',
	run(ctx, args) {
		const npc = ctx.client.npc;
		const sub = args[0];
		switch (sub) {
			case 'talk': {
				const arg = args.slice(1).join(' ').trim();
				if (!arg) {
					log.event('usage: /npc talk <naid|name>');
					return;
				}
				let naid;
				if (/^\d+$/.test(arg)) {
					naid = Number(arg);
				} else {
					naid = resolveNpcByName(ctx.client, arg);
					if (naid == null) {
						log.event('no NPC named "' + arg + '" in view — check /entities npc, or pass the naid');
						return;
					}
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
				log.event('usage: /npc talk <naid|name> | next | choose <i> | close | num <v> | str <text>');
		}
	}
};
