/**
 * Node/resolve/targets.js
 *
 * Friendly target-name → id for CZ.USE_SKILL2.targetID (which is a GID).
 *
 * - 'me' / 'self' / own character name → Session.GID (always correct).
 * - a party member → the member GID when the roster carries it
 *   (ZC.GROUP_LIST3 / ADD_MEMBER v3-4); otherwise the member AID with a
 *   caveat, since without an entity tracker (jalon 2) no GID is known for
 *   members served by the GID-less roster variants.
 */
import Session from 'Engine/SessionStorage.js';

/**
 * @param {string|number} input target name, 'me'/'self', or a raw id
 * @param {object} [party] PartyState (getByName) for member lookup
 * @returns {?{id: number, kind: 'gid'|'aid', name: string, self: boolean, caveat?: string}}
 */
export function resolveTarget(input, party) {
	const selfGid = Session.GID;
	const selfName = Session.Character && Session.Character.name;

	if (input == null || input === '') {
		return { id: selfGid, kind: 'gid', name: selfName || 'me', self: true };
	}

	// a raw numeric id passes through untouched (caller-supplied GID)
	if (typeof input === 'number') {
		return { id: input, kind: 'gid', name: String(input), self: input === selfGid };
	}

	const raw = String(input).trim();
	const key = raw.toLowerCase();
	if (key === 'me' || key === 'self' || (selfName && key === selfName.toLowerCase())) {
		return { id: selfGid, kind: 'gid', name: selfName || 'me', self: true };
	}

	if (party) {
		const member = party.getByName(raw);
		if (member) {
			if (member.gid) {
				return { id: member.gid, kind: 'gid', name: member.name, self: false };
			}
			return {
				id: member.aid,
				kind: 'aid',
				name: member.name,
				self: false,
				caveat: 'roster has no GID for this member — AID fallback (needs GROUP_LIST3 or entity tracking)'
			};
		}
	}

	return null;
}
