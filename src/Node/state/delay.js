/**
 * Node/state/delay.js
 *
 * After-cast delay tracker. Two sources gate a recast:
 *  - per-skill: ZC.SKILL_POSTDELAY {SKID, DelayTM} (+ the _LIST batch).
 *  - global: the self POSTDELAY(46) EFST RemainMS, read from StatusState.
 *
 * canCast(skid) is true only when both are elapsed. This is the gate the
 * Skill façade and the AutoBuff routine (session 3) consult before casting.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import StatusConst from 'DB/Status/StatusConst.js';
import Session from 'Engine/SessionStorage.js';
import { observePacket } from '../net/observe.js';

const POSTDELAY_EFST = StatusConst.POSTDELAY; // 46
// Gap enforced after a cast completes before the next one. The server enforces
// an inter-cast gate that it doesn't always communicate (instant buffs like
// Blessing send no POSTDELAY), and which isn't cleanly derivable from rAthena
// default. Measured empirically from the debug logs: casts dropped at 136/401 ms,
// accepted at 1003/1006 ms → the real gate is ~1000 ms. 1100 clears it with
// margin. A real POSTDELAY overrides it when longer. The AutoBuff routine also
// detects silently-dropped casts and grows an extra back-off on top, so a larger
// gate (another server / skill) self-corrects — but on this server 1100 already
// prevents the drop up front.
const CAST_TAIL_MS = 1100;

export class DelayState extends EventEmitter {
	/**
	 * @param {object} status StatusState — source of the global POSTDELAY
	 */
	constructor(status) {
		super();
		this.status = status;
		this.bySkid = {}; // skid → absolute end timestamp (ms)
		this.castingUntil = 0; // absolute ms — a cast is in flight until then
	}

	install() {
		observePacket(PACKET.ZC.SKILL_POSTDELAY, pkt => this._onDelay(pkt.SKID, pkt.DelayTM));
		observePacket(PACKET.ZC.SKILL_POSTDELAY_LIST, pkt => {
			const list = pkt.delayList || [];
			for (let i = 0, n = list.length; i < n; ++i) {
				this._onDelay(list[i].SKID, list[i].DelayTM);
			}
		});
		// Our own cast bar: ZC.USESKILL_ACK{,2,3} carries the cast time
		// (delayTime). While it runs the character is busy — casting anything
		// else cancels the current cast (the server drops the new one). Gate on
		// it so buffs with a cast time (Magnificat, delayed Blessing) aren't
		// interrupted by the next queued cast. (Undefined variants no-op.)
		observePacket(PACKET.ZC.USESKILL_ACK, pkt => this._onCast(pkt));
		observePacket(PACKET.ZC.USESKILL_ACK2, pkt => this._onCast(pkt));
		observePacket(PACKET.ZC.USESKILL_ACK3, pkt => this._onCast(pkt));
		return this;
	}

	_onCast(pkt) {
		if (pkt.AID === Session.AID) {
			// cast time + a tail so the after-cast (POSTDELAY) can register before
			// we're considered free — casting into that gap gets dropped server-side.
			this.castingUntil = Date.now() + (pkt.delayTime || 0) + CAST_TAIL_MS;
			this.emit('cast', { skid: pkt.SKID, end: this.castingUntil });
		}
	}

	_onDelay(skid, delayMs) {
		const end = Date.now() + delayMs;
		this.bySkid[skid] = end;
		this.emit('delay', { skid, end });
	}

	// Self POSTDELAY(46) end, or 0 when not under a global after-cast delay.
	_globalDelayEnd() {
		const entry = this.status && this.status.get(Session.AID, POSTDELAY_EFST);
		return entry && entry.active ? entry.end : 0;
	}

	/**
	 * @param {number} skid
	 * @returns {number} ms remaining before the skill can be recast (0 = ready)
	 */
	remaining(skid) {
		const now = Date.now();
		const perSkid = this.bySkid[skid] || 0;
		// Also blocked while a cast is in flight (cast time not yet elapsed).
		return Math.max(0, perSkid - now, this._globalDelayEnd() - now, this.castingUntil - now);
	}

	canCast(skid) {
		return this.remaining(skid) === 0;
	}
}
