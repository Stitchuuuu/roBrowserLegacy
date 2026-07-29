/**
 * Node/routines/AutoHeal.js
 *
 * Auto-heal: keeps HP up on the caster and reachable party members by casting
 * Heal (AL_HEAL) on whoever drops below a configurable HP fraction, most-hurt
 * first, always respecting the server after-cast delay and the caster's own SP.
 *
 * Unlike AutoBuff (a binary EFST present/absent), the trigger here is a
 * continuous fraction hp/maxhp, and one cast may not be enough — so a target is
 * healed repeatedly until it climbs back above a higher `stopAt` mark
 * (hysteresis), never oscillating at the threshold edge.
 *
 * Configured by a named per-character profile
 * (config characters["<login>/<slot>"].autoheal[name] = { threshold, stopAt,
 * self, party }) — same multi-config shape as AutoBuff's profiles.
 *
 * Scheduling — reuses AutoBuff's fully event-driven scheduler verbatim: no
 * polling interval; re-evaluation is triggered by hp / sp / party / status
 * events and a single one-shot timer armed to the exact next actionable instant
 * (the real after-cast value read via skill.remaining). It sleeps precisely
 * until then.
 *
 * No-spam discipline (mirrors AutoBuff):
 *  - one cast per evaluation — the after-cast then gates the next;
 *  - skill.remaining() gates on SKILL_POSTDELAY + POSTDELAY(46);
 *  - a post-cast SETTLE window blocks any further cast for the round-trip;
 *  - a per-target pending grace (keyed by aid — Heal has no EFST) holds a target
 *    until an HP packet confirms the rise, so a second heal isn't fired into the
 *    first one's in-flight window;
 *  - an in-flight drop-watch retries a silently-refused cast with adaptive
 *    back-off.
 *
 * SP gate: Heal's SP cost is read from the tracked skill list
 * (skill.get('heal').spcost) — a heal we can't afford is skipped (not spammed);
 * an SP-regen event re-evaluates, so it resumes the instant SP recovers. Party
 * carries HP only (no member SP), so the SP gate is on our own SP.
 */
import Session from 'Engine/SessionStorage.js';
import { resolveSkill } from '../resolve/skills.js';
import { charKey } from '../config.js';
import { log, getVerbosity } from '../log.js';
import { Routine } from './Routine.js';

const SETTLE_MS = 250; // post-cast wait for the after-cast packet (RTT-bound)
// Hold a target after a heal until its HP packet confirms the new value. The HP
// event clears this early; the cap only guards the (rare) case where no HP
// packet follows the cast.
const GRACE_MS = 8000;

// Drop-detection: a cast the server silently refuses produces no USESKILL_ACK.
// If no ack lands within ACK_GRACE_MS the cast was dropped → retry, and grow an
// adaptive back-off that converges on the server's real inter-cast gate. It
// decays on a successful cast, settling just above the true gate.
const ACK_GRACE_MS = 700;
const DROP_BACKOFF_STEP = 300;
const DROP_BACKOFF_MAX = 3000;
const DROP_BACKOFF_DECAY = 150;

const DEFAULTS = { threshold: 0.5, stopAt: 0.9, self: true, party: true };

// Clamp a fraction into (0, 1]; fall back to `def` for a missing / bad value.
function frac01(v, def) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) {
		return def;
	}
	return n > 1 ? 1 : n;
}

export class AutoHeal extends Routine {
	constructor() {
		super('autoheal');
		this.client = null;
		this.opts = { ...DEFAULTS };
		this.profileName = null;
		this._healSkid = null;
		this.pending = {}; // aid → cast timestamp (post-cast grace)
		this._healing = {}; // aid → 1 — targets below stopAt being healed (hysteresis)
		this._timer = null;
		this._settleUntil = 0; // absolute ms — no casts before this (post-cast RTT guard)
		this._inflight = null; // { skid, aid, label, at } — cast awaiting its ACK
		this._backoffUntil = 0; // adaptive drop back-off deadline
		this._dropBackoff = 0; // current back-off amount (grows on drop, decays on success)
		this._onHp = null;
		this._onSp = null;
		this._onParty = null;
		this._onStatus = null;
		this._onCastAck = null;
	}

	start(client, args, ctx) {
		this.client = client;
		this.opts = this._resolveOptions(args, ctx);

		const heal = resolveSkill('heal');
		if (!heal) {
			log.warn('[autoheal] cannot resolve Heal skill — routine not armed');
			return;
		}
		this._healSkid = heal.skid;

		log.event(
			'[autoheal] armed' +
				(this.profileName ? ' "' + this.profileName + '"' : '') +
				': heal < ' +
				Math.round(this.opts.threshold * 100) +
				'% → ' +
				Math.round(this.opts.stopAt * 100) +
				'%' +
				(this.opts.self ? ' · self' : '') +
				(this.opts.party ? ' · party' : '')
		);

		// Event-driven re-evaluation. A self HP/SP packet, a member HP or roster
		// change, or a status change (POSTDELAY(46) landing) each wakes a pass.
		this._onHp = () => {
			delete this.pending[Session.AID];
			this._evaluateSoon();
		};
		this._onSp = () => this._evaluateSoon();
		this._onParty = e => {
			if (e && e.reason === 'hp') {
				delete this.pending[e.aid];
			}
			this._evaluateSoon();
		};
		this._onStatus = () => this._evaluateSoon();
		// A USESKILL_ACK for our heal = the server accepted it. Clears the in-flight
		// watch and decays the drop back-off.
		this._onCastAck = e => {
			if (this._inflight && e.skid === this._inflight.skid) {
				this._inflight = null;
				this._dropBackoff = Math.max(0, this._dropBackoff - DROP_BACKOFF_DECAY);
			}
		};
		client.on('hp', this._onHp);
		client.on('sp', this._onSp);
		client.on('party', this._onParty);
		client.on('status', this._onStatus);
		client.on('castAck', this._onCastAck);

		this._evaluate();
	}

	stop() {
		clearTimeout(this._timer);
		this._timer = null;
		if (this.client) {
			if (this._onHp) {
				this.client.off('hp', this._onHp);
			}
			if (this._onSp) {
				this.client.off('sp', this._onSp);
			}
			if (this._onParty) {
				this.client.off('party', this._onParty);
			}
			if (this._onStatus) {
				this.client.off('status', this._onStatus);
			}
			if (this._onCastAck) {
				this.client.off('castAck', this._onCastAck);
			}
		}
		this._onHp = null;
		this._onSp = null;
		this._onParty = null;
		this._onStatus = null;
		this._onCastAck = null;
		log.event('[autoheal] stopped');
	}

	onReconnect() {
		log.routine(this.name, 'reconnected — re-evaluating heals');
		this.pending = {};
		this._healing = {};
		this._settleUntil = 0;
		this._inflight = null;
		this._backoffUntil = 0;
		this._evaluateSoon();
	}

	/**
	 * Resolve args into the heal options. A single arg naming a saved profile
	 * expands to it; otherwise the character's defaults apply. Missing / bad
	 * fields fall back to DEFAULTS.
	 */
	_resolveOptions(args, ctx) {
		const cfg = ctx && ctx.config;
		let raw = null;
		if (args && args.length >= 1 && cfg) {
			const profiles =
				(cfg.characters && cfg.characters[charKey(cfg)] && cfg.characters[charKey(cfg)].autoheal) || {};
			if (profiles[args[0]] && typeof profiles[args[0]] === 'object') {
				raw = profiles[args[0]];
				this.profileName = args[0];
				log.routine(this.name, 'using profile "' + args[0] + '"');
			}
		}
		raw = raw || {};
		const threshold = frac01(raw.threshold, DEFAULTS.threshold);
		let stopAt = frac01(raw.stopAt, DEFAULTS.stopAt);
		if (stopAt < threshold) {
			stopAt = threshold; // hysteresis needs stopAt >= threshold
		}
		return {
			threshold,
			stopAt,
			self: raw.self == null ? DEFAULTS.self : !!raw.self,
			party: raw.party == null ? DEFAULTS.party : !!raw.party
		};
	}

	// Coalesce a burst of events into a single evaluation on the next turn.
	_evaluateSoon() {
		this._armTimer(0);
	}

	// Arm the one-shot wake timer to `ms` from now. Infinity = disarm (nothing
	// scheduled → the routine sleeps purely on events). A no-op once stopped.
	_armTimer(ms) {
		if (!this._onHp) {
			return;
		}
		clearTimeout(this._timer);
		this._timer = null;
		if (Number.isFinite(ms)) {
			this._timer = setTimeout(() => this._evaluate(), Math.max(0, ms));
		}
	}

	/**
	 * Single evaluation pass. Casts at most one heal (on the most-hurt eligible
	 * target), then arms the timer to the exact next actionable instant.
	 */
	_evaluate() {
		const client = this.client;
		if (!client || !client.connected) {
			return; // wait for onReconnect (state is stale anyway)
		}

		const now = Date.now();
		const opts = this.opts;

		// Drop-detection: a cast with no USESKILL_ACK within ACK_GRACE_MS was
		// silently refused → allow a retry and grow the adaptive back-off.
		if (this._inflight && now - this._inflight.at > ACK_GRACE_MS) {
			const it = this._inflight;
			this._inflight = null;
			delete this.pending[it.aid];
			this._dropBackoff = Math.min(this._dropBackoff + DROP_BACKOFF_STEP, DROP_BACKOFF_MAX);
			this._backoffUntil = now + this._dropBackoff;
			log.routine(this.name, it.label + ': cast dropped (no ack) → back off ' + this._dropBackoff + 'ms');
		}

		// Serialize casts: a cast still awaiting its ACK blocks any new cast until
		// it's acknowledged (ack clears _inflight → re-eval) or times out (drop).
		if (this._inflight) {
			this._armTimer(this._inflight.at + ACK_GRACE_MS - now);
			return;
		}
		if (now < this._backoffUntil) {
			this._armTimer(this._backoffUntil - now);
			return;
		}
		if (now < this._settleUntil) {
			this._armTimer(this._settleUntil - now);
			return;
		}

		const targets = this._targets(client, now);
		if (getVerbosity() >= 1) {
			this._logState(client, targets);
		}

		// Hysteresis + most-hurt-first selection. A target enters the healing set
		// when it drops below threshold and leaves it only above stopAt, so we keep
		// healing through the band between the two without oscillating.
		let best = null;
		let nextWake = Infinity;
		for (let i = 0, n = targets.length; i < n; ++i) {
			const t = targets[i];
			if (t.frac >= opts.stopAt) {
				delete this._healing[t.aid];
			} else if (t.frac < opts.threshold) {
				this._healing[t.aid] = 1;
			}
			if (!this._healing[t.aid]) {
				continue; // in the [threshold, stopAt) band, not (yet) triggered
			}
			const grace = this._pendingLeft(t.aid, now);
			if (grace > 0) {
				nextWake = Math.min(nextWake, grace); // just healed — await HP confirm
				continue;
			}
			if (!best || t.frac < best.frac) {
				best = t;
			}
		}

		if (!best) {
			this._armTimer(nextWake); // nobody to heal → sleep on events
			return;
		}

		// The real after-cast delay still holds → wake exactly when it elapses.
		const afterCast = client.skill.remaining('heal');
		if (afterCast > 0) {
			this._armTimer(Math.min(nextWake, afterCast));
			return;
		}

		// SP gate: skip (don't spam) a heal we can't afford. The 'sp' event
		// re-evaluates when SP regens, so it resumes the instant it recovers.
		const known = client.skill.get('heal');
		const cost = known && known.spcost;
		if (cost && client.player.sp < cost) {
			log.routine(this.name, 'sp ' + client.player.sp + '/' + cost + ' too low — waiting for regen');
			this._armTimer(nextWake);
			return;
		}

		// Castable now — one heal, then settle for the RTT and watch for the ACK.
		const res = client.doSkill('heal', best.ref);
		if (res && res.sent) {
			this.pending[best.aid] = now;
			this._settleUntil = now + SETTLE_MS;
			this._inflight = { skid: this._healSkid, aid: best.aid, label: best.label, at: now };
			log.event('[autoheal] Heal → ' + best.label + ' (' + Math.round(best.frac * 100) + '%)');
			this._armTimer(SETTLE_MS);
			return;
		}
		log.routine(this.name, 'heal → ' + best.label + ': ' + (res && res.reason));
		this._armTimer(nextWake);
	}

	/**
	 * Build the eligible-target list with live HP fractions. Self is added via
	 * the PlayerState overlay (the party self-entry reads 0/0 — party HP packets
	 * cover other members only). Members must be reachable: carry a gid, online,
	 * on our map.
	 */
	_targets(client, now) {
		const selfAid = Session.AID;
		const targets = [];
		if (this.opts.self) {
			const player = client.player;
			const maxhp = player.maxhp;
			if (maxhp > 0) {
				targets.push({ aid: selfAid, ref: 'me', label: 'self', frac: player.hp / maxhp });
			}
		}
		if (this.opts.party) {
			const selfMap = client.currentMap;
			const members = client.party.getMembers();
			for (let i = 0, n = members.length; i < n; ++i) {
				const m = members[i];
				if (!m.gid || m.aid === selfAid || !m.online || (selfMap && m.map && m.map !== selfMap)) {
					continue;
				}
				if (m.maxhp > 0) {
					targets.push({ aid: m.aid, ref: m.name, label: m.name, frac: m.hp / m.maxhp });
				}
			}
		}
		return targets;
	}

	// ms left in the post-cast grace for this target (0 = none / expired).
	_pendingLeft(aid, now) {
		const ts = this.pending[aid];
		if (ts == null) {
			return 0;
		}
		const left = GRACE_MS - (now - ts);
		if (left <= 0) {
			delete this.pending[aid];
			return 0;
		}
		return left;
	}

	// -v diagnostics: HP% per target and the after-cast delay still holding a heal.
	_logState(client, targets) {
		const parts = [];
		for (let i = 0, n = targets.length; i < n; ++i) {
			const t = targets[i];
			parts.push(t.label + '=' + Math.round(t.frac * 100) + '%');
		}
		const ac = client.skill.remaining('heal');
		log.routine(this.name, (parts.join(' ') || 'no targets') + (ac > 0 ? ' · aftercast ' + ac + 'ms' : ''));
	}
}
