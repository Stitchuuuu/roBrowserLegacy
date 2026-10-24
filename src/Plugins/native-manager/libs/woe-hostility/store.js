/**
 * store.js — the two rosters roBrowser keeps only as UI (the guild window's
 * ally list, the party window's rows), mirrored from their packets. Pure : the
 * handlers take decoded packets, index.js wires them to packet-observer.
 */

/** `relation` of a guild relation entry : 0 = ally, 1 = antagonist (rAthena `guild_alliance.opposition`). */
export const RELATION_ALLY = 0

/**
 * Allied guild ids, from ZC_MYGUILD_BASIC_INFO (the whole list) and
 * ZC_ADD_RELATED_GUILD / ZC_DELETE_RELATED_GUILD (one change).
 */
export function createAllyStore() {
	/** @type {Set<number>} */
	const allies = new Set()
	/** Whether a full list arrived since the last clear. */
	let known = false
	return {
		/** @param {{ relatedGuildList?: Array<{ relation: number, GDID: number }> }} pkt ZC_MYGUILD_BASIC_INFO */
		onList(pkt) {
			allies.clear()
			for (const g of (pkt && pkt.relatedGuildList) || []) {
				if (g.relation === RELATION_ALLY && g.GDID > 0) {
					allies.add(g.GDID)
				}
			}
			known = true
		},
		/** @param {{ Info?: { relation: number, GDID: number } }} pkt ZC_ADD_RELATED_GUILD */
		onAdd(pkt) {
			const g = pkt && pkt.Info
			if (g && g.relation === RELATION_ALLY && g.GDID > 0) {
				allies.add(g.GDID)
			}
		},
		/** @param {{ OpponentGDID: number, Relation: number }} pkt ZC_DELETE_RELATED_GUILD */
		onDelete(pkt) {
			if (pkt && pkt.Relation === RELATION_ALLY) {
				allies.delete(pkt.OpponentGDID)
			}
		},
		/** @param {number} gdid */
		has(gdid) {
			return allies.has(gdid)
		},
		/** @returns {number[]} */
		list() {
			return [...allies]
		},
		/** A full list arrived since the last clear. */
		get known() {
			return known
		},
		clear() {
			allies.clear()
			known = false
		},
	}
}

/**
 * Party member account ids, from ZC_GROUP_LIST* (the whole roster),
 * ZC_ADD_MEMBER_TO_GROUP* and ZC_DELETE_MEMBER_FROM_GROUP. A player entity's
 * GID is its account id, so the roster answers « is this entity in my party ».
 */
export function createPartyRoster() {
	/** @type {Set<number>} */
	const members = new Set()
	return {
		/** @param {{ groupInfo?: Array<{ AID: number }> }} pkt ZC_GROUP_LIST* */
		onList(pkt) {
			members.clear()
			for (const m of (pkt && pkt.groupInfo) || []) {
				if (m && m.AID) {
					members.add(m.AID)
				}
			}
		},
		/** @param {{ AID: number }} pkt ZC_ADD_MEMBER_TO_GROUP* */
		onAdd(pkt) {
			if (pkt && pkt.AID) {
				members.add(pkt.AID)
			}
		},
		/**
		 * Our own removal (left, expelled, party broken) empties the roster.
		 * @param {{ AID: number }} pkt ZC_DELETE_MEMBER_FROM_GROUP
		 * @param {number} selfAid
		 */
		onDelete(pkt, selfAid) {
			if (!pkt) {
				return
			}
			if (pkt.AID === selfAid) {
				members.clear()
			} else {
				members.delete(pkt.AID)
			}
		},
		/** @param {number} aid */
		has(aid) {
			return members.has(aid)
		},
		/** @returns {number[]} */
		list() {
			return [...members]
		},
		clear() {
			members.clear()
		},
	}
}
