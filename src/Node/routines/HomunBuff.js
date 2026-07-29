/**
 * Node/routines/HomunBuff.js
 *
 * Keeps buffs up on a homunculus — our own, and/or the one belonging to an
 * Alchemist-family party member.
 *
 * Why this can't reuse AutoBuff: a homunculus broadcasts NO status. Every buff
 * EFST we care about maps to BL_PC only in the server's StatusRelevantBLTypes
 * table, so clif_status_change returns before sending anything for a BL_HOM
 * (clif.cpp:6556). state/status.js can therefore never see a homun's buffs, and
 * an internal timer is the only available oracle.
 *
 * That timer is server-CONFIRMED, not blind. It is armed only when the server
 * broadcasts ZC_USE_SKILL for our cast (state/casts.js) — which also tells us
 * the level it actually applied, so the duration read from the skill table is
 * exact rather than assumed. Nothing else writes to `expiry`, so a cast that
 * never landed can never be mistaken for a buff that is up.
 *
 * Two server rules shape the scope:
 *
 *  - Magnificat / Gloria / Angelus can NEVER reach a homunculus. They are self
 *    AoEs whose splash walks party_foreachsamemap (party.cpp:1414), i.e. the PC
 *    roster only — a homunculus is structurally invisible to it. They are
 *    rejected from the profile rather than cast into the void.
 *
 *  - A non-master may be blocked outright. status_check_skilluse (status.cpp:2265)
 *    refuses any INF_SUPPORT_SKILL aimed at a BL_HOM whose master isn't the
 *    caster, when battle_config.hom_setting has HOMSET_NO_SUPPORT_SKILL (0x01) —
 *    set in rAthena's shipped default 0x3D. The refusal sends NOTHING back, so
 *    we detect it by absence, using the ack/castend pair as a classifier:
 *
 *      ack + castend  → applied
 *      ack, no castend → started then interrupted / target left our view
 *      no ack at all   → refused before casting: hom_setting, or out of range
 *
 *    Both silent gates in unit_skilluse_id2 sit before clif_skillcasting
 *    (unit.cpp:2217 and :2362 vs :2485), and that ack fires even for instant
 *    casts — which is what makes the distinction possible. Our own position
 *    separates the two: out of range is a range problem, in range is not.
 *
 * Ownership is a heuristic, because no packet links a homunculus to its master
 * (see state/homun.js). We use the same rule as the browser party-buff-bot: a
 * homunculus within `radius` cells (Chebyshev) of an Alchemist-family party
 * member is treated as theirs.
 *
 * Configured by a named per-character profile — config
 * characters["<login>/<slot>"].homunbuff[name] = { skills, own, party, radius,
 * spFloor, durations }.
 *
 * Scheduling reuses AutoBuff's scheduler verbatim: no polling interval, a single
 * one-shot timer armed to the exact next actionable instant, one cast per
 * evaluation, a post-cast SETTLE window for the round-trip.
 */
import SkillConst from 'DB/Skills/SkillConst.js';
import JobConst from 'DB/Jobs/JobConst.js';
import { resolveSkill } from '../resolve/skills.js';
import { buffDuration } from '../resolve/buffMap.js';
import { charKey } from '../config.js';
import { log, getVerbosity } from '../log.js';
import { Routine } from './Routine.js';

const THRESHOLD_MS = 10000; // recast when a buff has < 10 s left (pre-emptive)
const SETTLE_MS = 250; // post-cast wait for the after-cast packet (RTT-bound)

// Confirmation windows. UNACKED_GRACE_MS is how long we wait for the caststart
// ack before concluding the cast was refused outright; once acked, the deadline
// is re-armed to the server's own cast time plus a tail for the castend
// broadcast. A fixed grace would be wrong here — AL_INCAGI casts for 1 s and
// PR_KYRIE for 2 s, so both would look dropped every single time.
const UNACKED_GRACE_MS = 700;
const CASTEND_TAIL_MS = 600;

// A cast that started but never completed (interrupted, or the target walked out
// of our view before the broadcast) grows an adaptive global back-off, decaying
// on success — same self-tuning shape as AutoBuff's drop detection.
const DROP_BACKOFF_STEP = 300;
const DROP_BACKOFF_MAX = 3000;
const DROP_BACKOFF_DECAY = 150;

// A refusal is per-target, not global: hom_setting blocks only homunculi we
// don't own, so a global back-off would throttle our own homun too. Escalates
// so a permanently-refused target costs almost nothing; any confirmation on it
// resets the escalation.
const REFUSE_BACKOFF_MS = [2000, 8000, 30000, 120000];

const RANGE_RECHECK_MS = 3000; // out of range — homunculi move, look again soon
const SP_RECHECK_MS = 5000; // floor reached; the 'sp' event usually wakes us first
const DEFAULT_RANGE = 9; // fallback when the skill list has no range yet

// A vaporized homunculus keeps its block id (homun_data is not freed), but its
// statuses are cleared — so a re-summon looks like the same target with buffs
// that silently no longer exist. We can't tell that apart from walking out of
// view: both send CLR_OUTSIGHT. So after a long enough absence we assume the
// worst and re-buff. The cost of being wrong is one redundant cast; the cost of
// the opposite is an unbuffed homunculus for a full duration.
const RESUMMON_SUSPECT_MS = 30000;

// Drop expiry entries this long past their end — homunculi we'll never see
// again (other parties passing through town) would otherwise accumulate keys.
const EXPIRY_TTL_MS = 600000;

const MAX_HOMUNS = 4; // sanity cap on a crowded map

// Alchemist family — the classes that can own a homunculus. Matched against a
// party member's `class_`, which is the real class from the roster packet, so
// the cart-mounted view ids (PIG_*) never appear here.
const ALCHE_JOBS = {
	[JobConst.ALCHEMIST]: 1,
	[JobConst.ALCHEMIST_H]: 1,
	[JobConst.ALCHEMIST_B]: 1,
	[JobConst.GENETIC]: 1,
	[JobConst.GENETIC_H]: 1,
	[JobConst.GENETIC_B]: 1
};

// Cast order when several buffs are due at once.
const PRIORITY = [
	SkillConst.AL_INCAGI,
	SkillConst.AL_BLESSING,
	SkillConst.PR_KYRIE,
	SkillConst.PR_IMPOSITIO,
	SkillConst.PR_ASPERSIO
];

// Self-centered party AoEs — see the header: they cannot reach a homunculus.
const AOE_SELF = {
	[SkillConst.PR_MAGNIFICAT]: 1,
	[SkillConst.PR_GLORIA]: 1,
	[SkillConst.AL_ANGELUS]: 1
};

const DEFAULTS = { own: true, party: true, radius: 8, spFloor: 0 };

function priorityIndex(skid) {
	const i = PRIORITY.indexOf(skid);
	return i < 0 ? PRIORITY.length : i;
}

// Chebyshev distance — RO ranges are square, not circular.
function cheby(ax, ay, bx, by) {
	const dx = ax > bx ? ax - bx : bx - ax;
	const dy = ay > by ? ay - by : by - ay;
	return dx > dy ? dx : dy;
}

export class HomunBuff extends Routine {
	constructor() {
		super('homunbuff');
		this.client = null;
		this.wanted = []; // [{skid, name, display}]
		this.opts = { ...DEFAULTS };
		this.durations = {}; // skid → ms, per-profile override of the skill table
		this.profileName = null;
		this.expiry = {}; // "gid:skid" → absolute ms — written ONLY by a confirmed castend
		this._refused = {}; // "gid:skid" → { n, until } — escalating per-target refusal
		this._timer = null;
		this._settleUntil = 0; // absolute ms — no casts before this (post-cast RTT guard)
		this._inflight = null; // { gid, skid, key, …, deadline, acked } — cast awaiting confirmation
		this._backoffUntil = 0; // adaptive interrupt back-off deadline
		this._dropBackoff = 0; // current back-off amount (grows on drop, decays on success)
		this._diagOnce = {}; // tag → 1 — one-shot explanatory warnings
		this._onSkillUsed = null;
		this._onCastAck = null;
		this._onHomun = null;
		this._onParty = null;
		this._onStatus = null;
		this._onSp = null;
	}

	start(client, args, ctx) {
		this.client = client;
		this._resolveProfile(args, ctx);

		if (!this.wanted.length) {
			log.warn('[homunbuff] no valid buff to maintain — routine not armed');
			return;
		}

		log.event(
			'[homunbuff] armed' +
				(this.profileName ? ' "' + this.profileName + '"' : '') +
				': ' +
				this.wanted.map(b => b.display).join(', ') +
				(this.opts.own ? ' · own' : '') +
				(this.opts.party ? ' · party (radius ' + this.opts.radius + ')' : '')
		);

		// The castend broadcast — the only writer of `expiry`.
		this._onSkillUsed = e => this._confirm(e);
		// The caststart ack — re-arms the confirmation deadline to the server's
		// real cast time, and its absence is what identifies a silent refusal.
		this._onCastAck = e => {
			const it = this._inflight;
			if (!it || e.skid !== it.skid || (e.target && e.target !== it.gid)) {
				return;
			}
			it.acked = true;
			it.deadline = Date.now() + (e.delayTime || 0) + CASTEND_TAIL_MS;
		};
		this._onHomun = e => this._onHomunChange(e);
		this._onParty = () => this._evaluateSoon();
		// A status change is how the global POSTDELAY(46) after-cast arrives.
		this._onStatus = () => this._evaluateSoon();
		this._onSp = () => this._evaluateSoon();
		client.on('skillUsed', this._onSkillUsed);
		client.on('castAck', this._onCastAck);
		client.on('homun', this._onHomun);
		client.on('party', this._onParty);
		client.on('status', this._onStatus);
		client.on('sp', this._onSp);

		this._evaluate();
	}

	stop() {
		clearTimeout(this._timer);
		this._timer = null;
		if (this.client) {
			if (this._onSkillUsed) {
				this.client.off('skillUsed', this._onSkillUsed);
			}
			if (this._onCastAck) {
				this.client.off('castAck', this._onCastAck);
			}
			if (this._onHomun) {
				this.client.off('homun', this._onHomun);
			}
			if (this._onParty) {
				this.client.off('party', this._onParty);
			}
			if (this._onStatus) {
				this.client.off('status', this._onStatus);
			}
			if (this._onSp) {
				this.client.off('sp', this._onSp);
			}
		}
		this._onSkillUsed = null;
		this._onCastAck = null;
		this._onHomun = null;
		this._onParty = null;
		this._onStatus = null;
		this._onSp = null;
		log.event('[homunbuff] stopped');
	}

	onReconnect() {
		log.routine(this.name, 'reconnected — re-evaluating homunculus buffs');
		// Every unit is re-created on map re-entry, so every key we hold refers to
		// something that no longer exists.
		this.expiry = {};
		this._refused = {};
		this._inflight = null;
		this._settleUntil = 0;
		this._backoffUntil = 0;
		this._dropBackoff = 0;
		this._diagOnce = {};
		this._evaluateSoon();
	}

	/**
	 * Resolve args into the wanted buffs and the options. A single arg naming a
	 * saved profile expands to it; otherwise the args are an inline skill list.
	 * Skills that cannot work on a homunculus are dropped with a reason.
	 */
	_resolveProfile(args, ctx) {
		const cfg = ctx && ctx.config;
		let raw = null;
		if (args && args.length >= 1 && cfg) {
			const profiles =
				(cfg.characters && cfg.characters[charKey(cfg)] && cfg.characters[charKey(cfg)].homunbuff) || {};
			if (profiles[args[0]] && typeof profiles[args[0]] === 'object') {
				raw = profiles[args[0]];
				this.profileName = args[0];
				log.routine(this.name, 'using profile "' + args[0] + '"');
			}
		}
		raw = raw || {};

		const radius = Number(raw.radius);
		const spFloor = Number(raw.spFloor);
		this.opts = {
			own: raw.own == null ? DEFAULTS.own : !!raw.own,
			party: raw.party == null ? DEFAULTS.party : !!raw.party,
			radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULTS.radius,
			spFloor: Number.isFinite(spFloor) && spFloor >= 0 ? spFloor : DEFAULTS.spFloor
		};

		// Per-profile duration overrides, keyed by any skill alias, for a server
		// whose skill_db differs from the pre-renewal values in resolve/buffMap.js.
		this.durations = {};
		for (const alias in raw.durations || {}) {
			const resolved = resolveSkill(alias);
			const ms = Number(raw.durations[alias]);
			if (!resolved) {
				log.warn('[homunbuff] unknown skill "' + alias + '" in durations — ignored');
			} else if (!Number.isFinite(ms) || ms <= 0) {
				log.warn('[homunbuff] bad duration for "' + alias + '" — ignored');
			} else {
				this.durations[resolved.skid] = ms;
			}
		}

		const names = Array.isArray(raw.skills) ? raw.skills : args || [];
		const wanted = [];
		for (let i = 0, n = names.length; i < n; ++i) {
			const resolved = resolveSkill(names[i]);
			if (!resolved) {
				log.warn('[homunbuff] unknown skill "' + names[i] + '" — skipped');
				continue;
			}
			if (AOE_SELF[resolved.skid]) {
				log.warn(
					'[homunbuff] "' +
						resolved.display +
						'" is a self-centered party AoE — its splash only walks the player roster, ' +
						'so it can never reach a homunculus. Skipped.'
				);
				continue;
			}
			if (this.durations[resolved.skid] == null && buffDuration(resolved.skid, 1) == null) {
				log.warn(
					'[homunbuff] "' +
						resolved.display +
						'" has no known duration and a homunculus reports no status — ' +
						'add it to the profile\'s "durations" to maintain it. Skipped.'
				);
				continue;
			}
			if (resolved.skid === SkillConst.PR_SUFFRAGIUM) {
				log.warn('[homunbuff] "' + resolved.display + '" only shortens cast time — no effect on a homunculus');
			}
			wanted.push({ skid: resolved.skid, name: resolved.name, display: resolved.display });
		}

		wanted.sort((a, b) => priorityIndex(a.skid) - priorityIndex(b.skid));
		this.wanted = wanted;
	}

	// Coalesce a burst of events into a single evaluation on the next turn.
	_evaluateSoon() {
		this._armTimer(0);
	}

	// Arm the one-shot wake timer to `ms` from now. Infinity = disarm (nothing
	// scheduled → the routine sleeps purely on events). A no-op once stopped.
	_armTimer(ms) {
		if (!this._onSkillUsed) {
			return;
		}
		clearTimeout(this._timer);
		this._timer = null;
		if (Number.isFinite(ms)) {
			this._timer = setTimeout(() => this._evaluate(), Math.max(0, ms));
		}
	}

	/**
	 * Single evaluation pass. Casts at most one buff (highest priority actionable
	 * one), then arms the timer to the exact next actionable instant.
	 */
	_evaluate() {
		const client = this.client;
		if (!client || !client.connected) {
			return; // wait for onReconnect (state is stale anyway)
		}

		const now = Date.now();

		// A cast awaiting confirmation both blocks new casts and carries its own
		// deadline — resolving it is always the first thing a pass does.
		if (this._inflight) {
			if (now < this._inflight.deadline) {
				this._armTimer(this._inflight.deadline - now);
				return;
			}
			this._classifyTimeout(this._inflight, now);
			this._inflight = null;
		}

		if (now < this._backoffUntil) {
			this._armTimer(this._backoffUntil - now);
			return;
		}

		// Just cast — hold every cast until the after-cast packet can arrive.
		if (now < this._settleUntil) {
			this._armTimer(this._settleUntil - now);
			return;
		}

		this._pruneExpiry(now);
		const targets = this._targets(client);
		if (getVerbosity() >= 1) {
			this._logState(targets, now);
		}

		let nextWake = Infinity;

		for (let i = 0, n = this.wanted.length; i < n; ++i) {
			const buff = this.wanted[i];
			for (let t = 0, tn = targets.length; t < tn; ++t) {
				const target = targets[t];
				const key = target.gid + ':' + buff.skid;

				const refusedLeft = this._refusedLeft(key, now);
				if (refusedLeft > 0) {
					nextWake = Math.min(nextWake, refusedLeft);
					continue;
				}

				const untilNeed = this._untilNeeded(key, now);
				if (untilNeed > 0) {
					nextWake = Math.min(nextWake, untilNeed);
					continue;
				}

				// Out-of-range casts are refused silently, so filter them here
				// rather than burning a refusal window on them.
				if (this._outOfRange(target, buff.name)) {
					nextWake = Math.min(nextWake, RANGE_RECHECK_MS);
					continue;
				}

				// Needs casting, but the real after-cast delay still holds → wake
				// exactly when it elapses (the exact server value).
				const afterCast = client.skill.remaining(buff.name);
				if (afterCast > 0) {
					nextWake = Math.min(nextWake, afterCast);
					continue;
				}

				const known = client.skill.get(buff.name);
				const spcost = known && known.spcost;
				if (spcost && client.player.sp - spcost < this.opts.spFloor) {
					log.routine(this.name, buff.display + ' → ' + target.label + ': SP floor');
					nextWake = Math.min(nextWake, SP_RECHECK_MS);
					continue;
				}

				const res = client.doSkill(buff.name, target.gid);
				if (res && res.sent) {
					this._settleUntil = now + SETTLE_MS;
					this._inflight = {
						gid: target.gid,
						skid: buff.skid,
						name: buff.name,
						display: buff.display,
						label: target.label,
						own: target.own,
						level: res.level,
						key,
						at: now,
						deadline: now + UNACKED_GRACE_MS,
						acked: false
					};
					log.event('[homunbuff] Put ' + buff.display + ' → ' + target.label);
					this._armTimer(SETTLE_MS);
					return; // one cast per evaluation
				}
				log.routine(this.name, buff.display + ' → ' + target.label + ': ' + (res && res.reason));
			}
		}

		this._armTimer(nextWake); // Infinity when everything is up → sleep on events
	}

	/**
	 * The buff reached castend on our target. The ONLY writer of `expiry` — the
	 * duration is anchored to the moment the server says it applied, at the level
	 * the server says it applied.
	 */
	_confirm(e) {
		const it = this._inflight;
		// Correlate on (skid, target) only: `srcAid` is not reliably the caster —
		// PR_KYRIE broadcasts with the target as src (kyrieeleison.cpp:13).
		if (!it || e.skid !== it.skid || e.targetGid !== it.gid) {
			return;
		}
		this._inflight = null;
		this._dropBackoff = Math.max(0, this._dropBackoff - DROP_BACKOFF_DECAY);

		if (!e.result) {
			// A false result is sc_start() failing — a real refusal for the skills
			// that pass it through (Kyrie / Impositio / Suffragium / Aspersio).
			this._refuse(it.key, it.label, it.display + ': server refused');
		} else {
			delete this._refused[it.key];
			// `value` is clif_skill_nodamage's `heal` argument, which buffs use for
			// the level — but never above the level we asked for, so anything
			// outside that isn't a level and we fall back to what we requested.
			const level = e.value >= 1 && e.value <= it.level ? e.value : it.level;
			const ms = this.durations[it.skid] != null ? this.durations[it.skid] : buffDuration(it.skid, level);
			// A curve can bottom out at a level the table wasn't written for (a
			// server raising PR_SUFFRAGIUM past 3 would reach 0). An expiry in the
			// past would recast on every wake, so hold the target off instead.
			if (!(ms > 0)) {
				this._refuse(it.key, it.label, it.display + ': no usable duration at lv' + level);
				this._evaluateSoon();
				return;
			}
			this.expiry[it.key] = Date.now() + ms;
			log.routine(this.name, it.display + ' → ' + it.label + ': confirmed lv' + level + ' for ' + ms + 'ms');
		}
		this._evaluateSoon();
	}

	/**
	 * No castend arrived in time. `acked` says which side of the server's silent
	 * gates we fell on — see the header's classifier table.
	 */
	_classifyTimeout(it, now) {
		if (it.acked) {
			this._dropBackoff = Math.min(this._dropBackoff + DROP_BACKOFF_STEP, DROP_BACKOFF_MAX);
			this._backoffUntil = now + this._dropBackoff;
			log.routine(
				this.name,
				it.label + ': cast started but never completed → back off ' + this._dropBackoff + 'ms'
			);
			return;
		}

		// Nothing came back at all: refused before the cast even started.
		const hom = this.client.homun.get(it.gid);
		const outOfRange = hom ? this._outOfRange(hom, it.name) : true;
		if (outOfRange) {
			this._warnOnce('range', 'homunculus out of casting range — moving closer would help');
		} else if (!it.own) {
			this._warnOnce(
				'hom_setting',
				"casts on a party member's homunculus are refused with no reply — this server very " +
					'likely runs hom_setting & HOMSET_NO_SUPPORT_SKILL (0x01), which restricts support ' +
					'skills on a homunculus to its own master. Only "own" targets can work here.'
			);
		}
		this._refuse(it.key, it.label, it.display + (outOfRange ? ': out of range' : ': silently refused'));
	}

	// Homunculus presence changed. `own` and a long-absent respawn both mean the
	// target's statuses may have been wiped without us seeing it (see
	// RESUMMON_SUSPECT_MS), so the timers we hold for it are no longer credible.
	_onHomunChange(e) {
		if (e.reason === 'own') {
			this._forget(e.gid);
		} else if (e.reason === 'spawn') {
			const last = this.client.homun.lastSeenAt(e.gid);
			if (last && Date.now() - last > RESUMMON_SUSPECT_MS) {
				this._forget(e.gid);
			}
		} else if (e.reason === 'vanish' && this._inflight && this._inflight.gid === e.gid) {
			// The castend is broadcast around the TARGET, so once it leaves our view
			// the confirmation can never arrive. Not a refusal — drop the watch
			// without any back-off or diagnostic.
			this._inflight = null;
		}
		this._evaluateSoon();
	}

	// Drop every timer and refusal we hold for one homunculus.
	_forget(gid) {
		const prefix = gid + ':';
		for (const key in this.expiry) {
			if (key.startsWith(prefix)) {
				delete this.expiry[key];
			}
		}
		for (const key in this._refused) {
			if (key.startsWith(prefix)) {
				delete this._refused[key];
			}
		}
	}

	/**
	 * Homunculi we may buff: our own, plus any sitting within `radius` cells of an
	 * Alchemist-family party member on our map. Nothing on the wire links a
	 * homunculus to its master, so proximity is the only attribution available.
	 */
	_targets(client) {
		const homs = client.homun.list();
		if (!homs.length) {
			return [];
		}

		const out = [];
		const ownId = client.homun.getOwnId();
		if (this.opts.own && ownId) {
			const own = client.homun.get(ownId);
			if (own) {
				out.push({ gid: ownId, label: own.name || 'own homun', x: own.x, y: own.y, own: true });
			}
		}

		if (this.opts.party) {
			// Party x/y is refreshed ~1 Hz but is NEVER cleared on a map change, so
			// a member elsewhere would otherwise keep matching on a stale cell.
			const selfMap = client.currentMap;
			const members = client.party.getMembers();
			const alch = [];
			for (let i = 0, n = members.length; i < n; ++i) {
				const m = members[i];
				if (m.online && ALCHE_JOBS[m.class_] && (!selfMap || m.map === selfMap) && (m.x || m.y)) {
					alch.push(m);
				}
			}
			const radius = this.opts.radius;
			for (let i = 0, n = homs.length; i < n; ++i) {
				const hom = homs[i];
				if (hom.gid === ownId) {
					continue;
				}
				for (let a = 0, an = alch.length; a < an; ++a) {
					if (cheby(hom.x, hom.y, alch[a].x, alch[a].y) <= radius) {
						out.push({
							gid: hom.gid,
							label: (hom.name || 'homun#' + hom.gid) + ' (' + alch[a].name + ')',
							x: hom.x,
							y: hom.y,
							own: false
						});
						break;
					}
				}
			}
		}

		return out.length > MAX_HOMUNS ? out.slice(0, MAX_HOMUNS) : out;
	}

	// True when the target is beyond the skill's server-declared range. Fails
	// OPEN while our own position is unknown — better to try and be refused than
	// to never cast at all.
	_outOfRange(target, skillName) {
		const player = this.client.player;
		if (!player.x && !player.y) {
			return false;
		}
		const known = this.client.skill.get(skillName);
		const range = (known && known.range) || DEFAULT_RANGE;
		return cheby(player.x, player.y, target.x, target.y) > range;
	}

	/**
	 * ms until the buff needs (re)casting on this target. 0 = needs it now (never
	 * confirmed, or within THRESHOLD_MS of expiry).
	 */
	_untilNeeded(key, now) {
		const end = this.expiry[key];
		if (end == null) {
			return 0;
		}
		const untilThreshold = end - THRESHOLD_MS - now;
		return untilThreshold > 0 ? untilThreshold : 0;
	}

	// ms left in this target's refusal window (0 = free to retry).
	_refusedLeft(key, now) {
		const entry = this._refused[key];
		if (!entry) {
			return 0;
		}
		const left = entry.until - now;
		return left > 0 ? left : 0;
	}

	// Widen this target's refusal window. `n` is kept once it elapses so a target
	// that keeps refusing escalates instead of retrying at the shortest delay
	// forever; a confirmation clears the entry outright.
	_refuse(key, label, why) {
		const entry = this._refused[key] || { n: 0, until: 0 };
		const ms = REFUSE_BACKOFF_MS[Math.min(entry.n, REFUSE_BACKOFF_MS.length - 1)];
		entry.n += 1;
		entry.until = Date.now() + ms;
		this._refused[key] = entry;
		log.routine(this.name, label + ' — ' + why + ' → retry in ' + ms + 'ms');
	}

	// Bound the expiry map: homunculi we'll never meet again leave keys behind.
	_pruneExpiry(now) {
		for (const key in this.expiry) {
			if (this.expiry[key] < now - EXPIRY_TTL_MS) {
				delete this.expiry[key];
			}
		}
	}

	// Explain a server-side limitation once, not on every retry.
	_warnOnce(tag, message) {
		if (this._diagOnce[tag]) {
			return;
		}
		this._diagOnce[tag] = 1;
		log.warn('[homunbuff] ' + message);
	}

	// -v diagnostics: every target with its per-buff time remaining.
	_logState(targets, now) {
		if (!targets.length) {
			log.routine(this.name, 'no homunculus in reach');
			return;
		}
		for (let t = 0, tn = targets.length; t < tn; ++t) {
			const target = targets[t];
			const parts = [];
			for (let i = 0, n = this.wanted.length; i < n; ++i) {
				const buff = this.wanted[i];
				const end = this.expiry[target.gid + ':' + buff.skid];
				parts.push(
					buff.display + '=' + (end == null ? 'off' : Math.max(0, Math.round((end - now) / 1000)) + 's')
				);
			}
			log.routine(this.name, target.label + ' @' + target.x + ',' + target.y + ' · ' + parts.join(' '));
		}
	}
}
