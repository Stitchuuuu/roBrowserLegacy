/**
 * rules.js — the pure « who can I hit » predicates, no engine import. index.js
 * feeds them the live Session / EntityManager state ; the tests feed them
 * simulated entities.
 *
 * The rule mirrors the server's `battle_check_target` (its `map_flag_vs`
 * branch) rather than the native client cursor
 * (`EntityControl.canAttackEntity`) where the two disagree :
 * - the client ignores alliances, the server treats an allied guild like ours ;
 * - the client lets a guildless player target only guildless players, the
 *   server lets him target everyone outside his party.
 * Same party wins over different guilds on the server too (an enemy flag is
 * stripped when the target is also party / guild), except on a `gvg_noparty`
 * map — a mapflag the client is never told about, so it is not handled here.
 *
 * On a PvP map (no GvG flag) the native rule is kept : everyone outside the
 * party. The server also spares our guild and its allies there unless the map
 * has `pvp_noguild`, which the client cannot see either.
 */

/** `Entity.TYPE_PC` */
export const TYPE_PC = 0
/** `Entity.TYPE_MOB` */
export const TYPE_MOB = 5
/** `Entity.TYPE_HOM` */
export const TYPE_HOM = 8
/** Emperium mob class (rAthena `MOBID_EMPERIUM`). */
export const EMPERIUM_CLASS = 1288
/**
 * Castle defenders spawned by the `guardian` script command : the WoE 1
 * guardians (1285-1287), the WoE 2 guardian soldier (1899), barricades
 * (1905, 1906) and guardian stones (1907, 1908). Like the Emperium they carry
 * the castle owner's guild id in their spawn packet (`status_get_guild_id` →
 * `guardian_data->guild_id`).
 */
export const GUARDIAN_CLASSES = new Set([1285, 1286, 1287, 1899, 1905, 1906, 1907, 1908])

/**
 * The fields read off a roBrowser `Entity`.
 * @typedef {object} EntityLike
 * @property {number} GID account id for a player, unit id otherwise
 * @property {number} objecttype `Entity.TYPE_*`
 * @property {number} [GUID] guild id, 0 = none ; a guardian / Emperium carries its castle owner's
 * @property {number} [job] class id (mob class for a mob)
 * @property {number} [action] current action id
 * @property {{ DIE: number }} [ACTION] the entity's action table
 * @property {number} [remove_tick] set while the entity fades out
 * @property {number[]} [position] cell `[x, y, z]`
 */

/**
 * Everything the predicates need besides the entity.
 * @typedef {object} HostilityContext
 * @property {EntityLike | null} self the controlled character
 * @property {boolean} isGVG `Session.mapState.isGVG`
 * @property {boolean} isPVP `Session.mapState.isPVP`
 * @property {number} myGuild our guild id, 0 = none
 * @property {(aid: number) => boolean} isPartyMember
 * @property {(gdid: number) => boolean} isAlly
 * @property {number} [ownHomunId] our homunculus' GID (`Session.homunId`), 0 = none
 */

/**
 * @typedef {object} TargetOptions
 * @property {boolean} [pvp=true] outside GvG, on a PvP map, count every player outside the party as hostile
 * @property {boolean} [includeGuardians=true] GvG : add the hostile castle defenders
 * @property {boolean} [includeEmperium=true] GvG : add a hostile Emperium (never when we have no guild)
 * @property {boolean} [includeHomunculi=false] GvG : add the homunculi whose owner's guild is hostile
 */

/**
 * @typedef {'player' | 'homunculus' | 'guardian' | 'emperium'} TargetKind
 */

/**
 * @typedef {object} HostileTarget
 * @property {number} gid
 * @property {TargetKind} kind
 * @property {EntityLike} entity
 * @property {number} distance cells from us (Chebyshev), Infinity when a position is missing
 */

/**
 * Dead, fading out, or a placeholder (GID ≤ 0, left by the engine during a
 * death fade).
 * @param {EntityLike} e
 * @returns {boolean}
 */
export function isGone(e) {
	if (!e || !(e.GID > 0) || e.remove_tick) {
		return true
	}
	return !!e.ACTION && e.action === e.ACTION.DIE
}

/**
 * Our guild or an allied one.
 * @param {number} gdid
 * @param {HostilityContext} ctx
 * @returns {boolean}
 */
function isFriendlyGuild(gdid, ctx) {
	return ctx.myGuild > 0 && gdid > 0 && (gdid === ctx.myGuild || ctx.isAlly(gdid))
}

/**
 * Is this player one the server lets us attack ?
 * - GvG map : not in our party, not in our guild nor an allied one ;
 * - PvP map (when `pvp` is on) : not in our party ;
 * - anywhere else : never.
 * @param {EntityLike} e
 * @param {HostilityContext} ctx
 * @param {boolean} [pvp=true]
 * @returns {boolean}
 */
export function isHostilePlayer(e, ctx, pvp = true) {
	if (!e || e.objecttype !== TYPE_PC || isGone(e)) {
		return false
	}
	if (e === ctx.self || (ctx.self && e.GID === ctx.self.GID)) {
		return false
	}
	if (!ctx.isGVG && !(pvp && ctx.isPVP)) {
		return false
	}
	if (ctx.isPartyMember(e.GID)) {
		return false
	}
	return !ctx.isGVG || !isFriendlyGuild(e.GUID || 0, ctx)
}

/**
 * What kind of WoE target this entity is, or `null` when it is not one we may
 * hit. A guardian / Emperium of our guild or an allied one is never a target ;
 * the Emperium is never a target when we have no guild, as on the server.
 *
 * A homunculus carries its owner's guild id in its spawn packet
 * (`status_get_guild_id` → `master->status.guild_id`) and the server judges it
 * by its owner (`battle_check_target` swaps a homunculus for its master), so it
 * is hostile when that guild is neither ours nor an ally. The owner's party is
 * not sent : a party member's homunculus from another guild still shows here.
 * @param {EntityLike} e
 * @param {HostilityContext} ctx
 * @param {TargetOptions} [opts]
 * @returns {TargetKind | null}
 */
export function targetKind(e, ctx, opts = {
}) {
	const { pvp = true, includeGuardians = true, includeEmperium = true, includeHomunculi = false } = opts
	if (isHostilePlayer(e, ctx, pvp)) {
		return 'player'
	}
	if (!ctx.isGVG || !e || isGone(e)) {
		return null
	}
	if (isFriendlyGuild(e.GUID || 0, ctx)) {
		return null
	}
	if (e.objecttype === TYPE_HOM) {
		return includeHomunculi && e.GID !== ctx.ownHomunId ? 'homunculus' : null
	}
	if (e.objecttype !== TYPE_MOB) {
		return null
	}
	if (e.job === EMPERIUM_CLASS) {
		return includeEmperium && ctx.myGuild > 0 ? 'emperium' : null
	}
	if (GUARDIAN_CLASSES.has(e.job)) {
		return includeGuardians ? 'guardian' : null
	}
	return null
}

const KIND_ORDER = {
	player: 0,
	homunculus: 1,
	guardian: 2,
	emperium: 3,
}

/**
 * Cell distance between two entities, Infinity when one has no position.
 * @param {EntityLike | null} a
 * @param {EntityLike} b
 * @returns {number}
 */
function cellDistance(a, b) {
	const p = a && a.position
	const q = b.position
	if (!p || !q) {
		return Infinity
	}
	return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]))
}

/**
 * Every hostile target among `entities` : players first, then homunculi (when
 * asked for), then guardians, then the Emperium, each group nearest first.
 * @param {Iterable<EntityLike>} entities
 * @param {HostilityContext} ctx
 * @param {TargetOptions} [opts]
 * @returns {HostileTarget[]}
 */
export function collectTargets(entities, ctx, opts) {
	const out = []
	for (const entity of entities) {
		const kind = targetKind(entity, ctx, opts)
		if (kind) {
			out.push({
				gid: entity.GID,
				kind,
				entity,
				distance: cellDistance(ctx.self, entity),
			})
		}
	}
	return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.distance - b.distance)
}
