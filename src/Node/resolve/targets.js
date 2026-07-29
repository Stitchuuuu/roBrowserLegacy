/**
 * Node/resolve/targets.js
 *
 * Friendly target-name → block id for CZ.USE_SKILL2.targetID.
 *
 * On the map a player entity is identified by its ACCOUNT id (AID): that is the
 * block id the zone server uses, the value roBrowser stores as entity.GID
 * (MapEngine sets Session.Character.GID = pkt.AID at map entry and casts self by
 * Session.Entity.GID — MapEngine/Skill.js:675), and the value status packets
 * carry as pkt.AID. So 'me' and party members both resolve to an AID — matching
 * how state/status.js keys effects, so a cast and its status readback agree.
 *
 * NB: NOT Session.GID (the char id from NOTIFY_ZONESVR) — targeting self by that
 * made the server drop the cast (the buff never applied), which the town
 * autobuff then respammed.
 */
import Session from 'Engine/SessionStorage.js';

/**
 * @param {string|number} input target name, 'me'/'self', or a raw block id
 * @param {object} [party] PartyState (getByName) for member lookup
 * @returns {?{id: number, kind: 'aid', name: string, self: boolean}}
 */
export function resolveTarget(input, party) {
	const selfId = Session.AID;
	const selfName = Session.Character && Session.Character.name;

	if (input == null || input === '') {
		return { id: selfId, kind: 'aid', name: selfName || 'me', self: true };
	}

	// a raw numeric id passes through untouched (caller-supplied block id)
	if (typeof input === 'number') {
		return { id: input, kind: 'aid', name: String(input), self: input === selfId };
	}

	const raw = String(input).trim();
	const key = raw.toLowerCase();
	if (key === 'me' || key === 'self' || (selfName && key === selfName.toLowerCase())) {
		return { id: selfId, kind: 'aid', name: selfName || 'me', self: true };
	}

	// a numeric string is a raw block id (aid) passed straight through
	if (/^\d+$/.test(raw)) {
		const id = Number(raw);
		return { id, kind: 'aid', name: raw, self: id === selfId };
	}

	if (party) {
		const member = party.getByName(raw);
		if (member) {
			// A member is targeted by its AID (its map block id), same as self.
			return { id: member.aid, kind: 'aid', name: member.name, self: member.aid === selfId };
		}
	}

	return null;
}
