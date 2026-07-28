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

export class DelayState extends EventEmitter {
	/**
	 * @param {object} status StatusState — source of the global POSTDELAY
	 */
	constructor(status) {
		super();
		this.status = status;
		this.bySkid = {}; // skid → absolute end timestamp (ms)
	}

	install() {
		observePacket(PACKET.ZC.SKILL_POSTDELAY, pkt => this._onDelay(pkt.SKID, pkt.DelayTM));
		observePacket(PACKET.ZC.SKILL_POSTDELAY_LIST, pkt => {
			const list = pkt.delayList || [];
			for (let i = 0, n = list.length; i < n; ++i) {
				this._onDelay(list[i].SKID, list[i].DelayTM);
			}
		});
		return this;
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
		return Math.max(0, perSkid - now, this._globalDelayEnd() - now);
	}

	canCast(skid) {
		return this.remaining(skid) === 0;
	}
}
