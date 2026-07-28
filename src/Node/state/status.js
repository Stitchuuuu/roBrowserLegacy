/**
 * Node/state/status.js
 *
 * EFST (status-effect) tracker, indexed AID → { efstIndex → entry }. The
 * native client discards party-member buffs (StatusIcons.update is gated
 * entity===Session.Entity) — we hook the five MSG_STATE_CHANGE* ourselves
 * and keep every unit's effects.
 *
 * Three of the five carry an explicit on/off `state` byte; the other two
 * (0x8ff / 0x984) imply presence=ON. Timers vary: none / RemainMS only /
 * TotalMS+RemainMS. We store an absolute `end` (0 = no expiry).
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

export class StatusState extends EventEmitter {
	constructor() {
		super();
		this.byAid = {}; // aid → { efstIndex → { active, end, total, val } }
	}

	install() {
		// explicit state byte (on/off)
		observePacket(PACKET.ZC.MSG_STATE_CHANGE, pkt => this._apply(pkt.AID, pkt.index, pkt.state !== 0, 0, 0, null));
		observePacket(PACKET.ZC.MSG_STATE_CHANGE2, pkt =>
			this._apply(pkt.AID, pkt.index, pkt.state !== 0, pkt.RemainMS, 0, pkt.val)
		);
		observePacket(PACKET.ZC.MSG_STATE_CHANGE4, pkt =>
			this._apply(pkt.AID, pkt.index, pkt.state !== 0, pkt.RemainMS, pkt.TotalMS, pkt.val)
		);
		// presence-implied ON (no state byte)
		observePacket(PACKET.ZC.MSG_STATE_CHANGE3, pkt =>
			this._apply(pkt.AID, pkt.index, true, pkt.RemainMS, 0, pkt.val)
		);
		observePacket(PACKET.ZC.MSG_STATE_CHANGE5, pkt =>
			this._apply(pkt.AID, pkt.index, true, pkt.RemainMS, pkt.TotalMS, pkt.val)
		);
		return this;
	}

	_apply(aid, index, active, remainMS, totalMS, val) {
		let bucket = this.byAid[aid];
		if (!bucket) {
			bucket = this.byAid[aid] = {};
		}

		let end = 0;
		if (active) {
			end = remainMS > 0 ? Date.now() + remainMS : 0;
			bucket[index] = { active: true, end, total: totalMS || 0, val: val || null };
		} else {
			delete bucket[index];
		}

		this.emit('status', { aid, efst: index, active, end });
	}

	/**
	 * @param {number} aid
	 * @param {number} [efst] omit to get the whole per-AID bucket
	 * @returns {?object} entry, bucket, or null
	 */
	get(aid, efst) {
		const bucket = this.byAid[aid];
		if (!bucket) {
			return null;
		}
		if (efst == null) {
			return bucket;
		}
		return bucket[efst] || null;
	}

	has(aid, efst) {
		const entry = this.get(aid, efst);
		return !!(entry && entry.active);
	}
}
