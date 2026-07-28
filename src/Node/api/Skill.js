/**
 * Node/api/Skill.js
 *
 * Skill façade. Reads the tracked skill list and emits the outgoing cast.
 * doSkill resolves the friendly skill name → SKID and target name → id,
 * gates on the after-cast delay, then builds CZ.USE_SKILL2 (or the older
 * CZ.USE_SKILL) — same field mapping as MapEngine/Skill.js:onUseSkill.
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';
import { resolveSkill } from '../resolve/skills.js';
import { resolveTarget } from '../resolve/targets.js';

export class Skill extends EventEmitter {
	constructor(skillState, delayState, partyState) {
		super();
		this._skills = skillState;
		this._delay = delayState;
		this._party = partyState;
	}

	getSkills() {
		return this._skills.getSkills();
	}

	get(name) {
		const resolved = resolveSkill(name);
		return resolved ? this._skills.get(resolved.skid) : null;
	}

	canCast(name) {
		const resolved = resolveSkill(name);
		return resolved ? this._delay.canCast(resolved.skid) : false;
	}

	/**
	 * Emit a skill cast. Target defaults to self ('me' → Session.GID).
	 *
	 * @param {string|number} name skill alias / const name / SKID
	 * @param {string|number} [target] target name / 'me' / raw id
	 * @param {number} [level] override; defaults to the known/learned level
	 * @returns {{sent: boolean, reason?: string, skid?: number, level?: number, target?: number, targetKind?: string}}
	 */
	doSkill(name, target, level) {
		const resolved = resolveSkill(name);
		if (!resolved) {
			this.emit('blocked', { name, reason: 'unknown skill' });
			return { sent: false, reason: 'unknown skill' };
		}

		const skid = resolved.skid;
		const tgt = resolveTarget(target, this._party);
		if (!tgt) {
			this.emit('blocked', { skid, reason: 'unknown target' });
			return { sent: false, reason: 'unknown target' };
		}

		if (!this._delay.canCast(skid)) {
			const reason = 'after-cast delay (' + this._delay.remaining(skid) + 'ms)';
			this.emit('blocked', { skid, target: tgt.id, reason });
			return { sent: false, reason };
		}

		const known = this._skills.get(skid);
		const lv = level || (known && known.level) || 1;

		const pkt = PACKETVER.value >= 20180307 ? new PACKET.CZ.USE_SKILL2() : new PACKET.CZ.USE_SKILL();
		pkt.SKID = skid;
		pkt.selectedLevel = lv;
		pkt.targetID = tgt.id;
		Network.sendPacket(pkt);

		const cast = { skid, name: resolved.name, level: lv, target: tgt.id, targetKind: tgt.kind };
		if (tgt.caveat) {
			cast.caveat = tgt.caveat;
		}
		this.emit('cast', cast);
		return { sent: true, ...cast };
	}
}
