/**
 * woe-hostility — « may I hit this player ? » for WoE (and PvP),
 * shared by every plugin that picks targets among players.
 *
 * The native client answers it for the attack cursor only
 * (`EntityControl.canAttackEntity`), with no export and without alliances. This
 * lib answers it from the live state : `Session.mapState`, our guild id, plus two
 * rosters the engine only keeps as UI and that are mirrored here from their
 * packets — the party (ZC_GROUP_LIST*) and the allied guilds
 * (ZC_MYGUILD_BASIC_INFO, ZC_ADD_RELATED_GUILD, ZC_DELETE_RELATED_GUILD). The
 * rule itself lives in rules.js.
 *
 * The server sends the alliance list only when the guild window's first tab is
 * asked for (CZ_REQ_GUILD_MENU type 0) or when an alliance changes. So once we
 * know our guild (ZC_UPDATE_GDID), the lib asks for it itself, once per guild
 * per login — the same request the guild window sends when it opens.
 */

import { Session, EntityManager, PACKET, Network } from '../plugin-api.js'
import { observePacket } from '../packet-observer.js'
import { on, once, EVENTS } from '../event-bus.js'
import { isHostilePlayer, collectTargets, EMPERIUM_CLASS, GUARDIAN_CLASSES } from './rules.js'
import { createAllyStore, createPartyRoster } from './store.js'

export { EMPERIUM_CLASS, GUARDIAN_CLASSES }

/** @typedef {import('./rules.js').EntityLike} EntityLike */
/** @typedef {import('./rules.js').TargetOptions} TargetOptions */
/** @typedef {import('./rules.js').HostileTarget} HostileTarget */
/** @typedef {import('./rules.js').HostilityContext} HostilityContext */

const allies = createAllyStore()
const party = createPartyRoster()
/** Our guild id from the last ZC_UPDATE_GDID, 0 = none seen. */
let myGdid = 0
/** Guild id the alliance list was last asked for. */
let requestedGdid = 0
let hooked = false

/** @returns {HostilityContext} */
function context() {
	const self = Session.Entity || null
	const mapState = Session.mapState || {
	}
	return {
		self,
		isGVG: !!mapState.isGVG,
		isPVP: !!mapState.isPVP,
		myGuild: (self && self.GUID) || (Session.hasGuild ? myGdid : 0),
		isPartyMember: aid => !!Session.hasParty && party.has(aid),
		isAlly: gdid => allies.has(gdid),
		ownHomunId: Session.homunId || 0,
	}
}

/** @returns {EntityLike[]} */
function entities() {
	const out = []
	EntityManager.forEach(e => {
		out.push(e)
	})
	return out
}

/**
 * Is this entity a player we may attack right now ? A player, not us, alive,
 * on a GvG map : outside our party, our guild and its allies. On a PvP map
 * (no GvG flag) : outside our party — turn that off with `{ pvp: false }`.
 * Guardians and the Emperium are not players : see `hostileTargets`.
 * @param {EntityLike} entity
 * @param {{ pvp?: boolean }} [opts]
 * @returns {boolean}
 */
export function isHostile(entity, opts = {
}) {
	return isHostilePlayer(entity, context(), opts.pvp !== false)
}

/**
 * GIDs (account ids) of the hostile players in sight, nearest first.
 * @param {{ pvp?: boolean }} [opts]
 * @returns {number[]}
 */
export function hostileGids(opts = {
}) {
	return collectTargets(entities(), context(), {
		pvp: opts.pvp !== false,
		includeGuardians: false,
		includeEmperium: false,
	}).map(t => t.gid)
}

/**
 * Every hostile target in sight : players, then (GvG only) homunculi when
 * `includeHomunculi` is set, guardians, then the Emperium, each group nearest
 * first. Our guild's and our allies' homunculi, guardians and Emperium are left
 * out, so is our own homunculus, and so is any Emperium while we have no guild.
 * @param {TargetOptions} [opts]
 * @returns {HostileTarget[]}
 */
export function hostileTargets(opts) {
	return collectTargets(entities(), context(), opts)
}

/**
 * Is this guild allied to ours ?
 * @param {number} gdid
 * @returns {boolean}
 */
export function isAlly(gdid) {
	return allies.has(gdid)
}

/** @returns {number[]} allied guild ids */
export function allyGuilds() {
	return allies.list()
}

/**
 * Ask the server for our alliance list now (CZ_REQ_GUILD_MENU type 0). The lib
 * already does it once per guild per login ; call it after a doubt.
 * @returns {boolean} false when there is no guild or no network yet
 */
export function refreshAllies() {
	const gdid = myGdid || (Session.Entity && Session.Entity.GUID) || 0
	if (!gdid || !PACKET.CZ || !PACKET.CZ.REQ_GUILD_MENU) {
		return false
	}
	try {
		const pkt = new PACKET.CZ.REQ_GUILD_MENU()
		pkt.Type = 0
		Network.sendPacket(pkt)
	} catch (e) {
		console.error('[RO][woe-hostility] alliance list request failed:', e)
		return false
	}
	requestedGdid = gdid
	return true
}

/** Diagnostic snapshot. */
export function woeHostilityStatus() {
	const ctx = context()
	return {
		hooked,
		isGVG: ctx.isGVG,
		isPVP: ctx.isPVP,
		myGuild: ctx.myGuild,
		alliesKnown: allies.known,
		allies: allies.list(),
		party: party.list(),
	}
}

/** @param {{ GDID?: number }} pkt ZC_UPDATE_GDID* */
function onGuildId(pkt) {
	const gdid = (pkt && pkt.GDID) || 0
	if (gdid !== myGdid) {
		allies.clear()
		myGdid = gdid
	}
	if (gdid && requestedGdid !== gdid && !allies.known) {
		refreshAllies()
	}
}

function reset() {
	allies.clear()
	party.clear()
	myGdid = 0
	requestedGdid = 0
}

function hookPackets() {
	if (hooked) {
		return
	}
	hooked = true
	const Z = PACKET.ZC
	const sub = (cls, cb) => {
		if (cls) {
			observePacket(cls, cb)
		}
	}
	sub(Z.MYGUILD_BASIC_INFO, allies.onList)
	sub(Z.ADD_RELATED_GUILD, allies.onAdd)
	sub(Z.DELETE_RELATED_GUILD, allies.onDelete)
	sub(Z.UPDATE_GDID, onGuildId)
	sub(Z.UPDATE_GDID2, onGuildId)
	for (const n of ['GROUP_LIST', 'GROUP_LIST2', 'GROUP_LIST3']) {
		sub(Z[n], party.onList)
	}
	for (const n of ['ADD_MEMBER_TO_GROUP', 'ADD_MEMBER_TO_GROUP2', 'ADD_MEMBER_TO_GROUP3', 'ADD_MEMBER_TO_GROUP4']) {
		sub(Z[n], party.onAdd)
	}
	sub(Z.DELETE_MEMBER_FROM_GROUP, pkt => party.onDelete(pkt, Session.AID))
}

// PACKET is filled by the bundle after the libs load : hook now if it is
// already there, else when lifecycle reports the wire complete.
if (PACKET && PACKET.ZC && PACKET.ZC.MYGUILD_BASIC_INFO) {
	hookPackets()
} else {
	once(EVENTS.WIRE_COMPLETE, hookPackets)
}
// A relog or a character switch starts from empty rosters ; the server
// re-sends the party list and ZC_UPDATE_GDID on the next map entry.
on(EVENTS.CHAR_SELECT, reset)
on(EVENTS.LOGOUT, reset)
