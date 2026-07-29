/**
 * Node/state/casts.js
 *
 * "A no-damage skill just landed on unit Y." Taps ZC_USE_SKILL, which the
 * server AREA-broadcasts around the TARGET whenever a supportive skill reaches
 * castend (clif_skill_nodamage, clif.cpp:6161). Two opcodes carry it — 0x11a
 * (ZC.USE_SKILL, level as i16) on old clients and 0x9cb (ZC.USE_SKILL2, level
 * as i32) from PACKETVER_RE 20130724 onwards. Both are statically registered
 * and never remapped by PacketVersions.js, so we observe both and only one ever
 * arrives.
 *
 * This is the only way to know a buff applied to something whose EFST we can
 * never see: a homunculus (see state/homun.js), a mercenary, an elemental, or a
 * player outside our view. It is deliberately unfiltered — routines correlate.
 *
 * Three traps in the payload, all verified against rAthena:
 *
 *  - `srcAid` is NOT reliably the caster. Each skill picks what it passes as
 *    `src`: PR_KYRIE passes the TARGET (kyrieeleison.cpp:13 —
 *    `clif_skill_nodamage(target,*target,…)`), so srcAid === targetGid there,
 *    while AL_BLESSING / AL_INCAGI pass the real caster. **Correlate on
 *    (skid, targetGid), never on srcAid.**
 *
 *  - `value` is clif_skill_nodamage's `heal` argument (clif.cpp:6165). Buffs
 *    pass their skill level; AL_HEAL passes the HP amount healed
 *    (heal.cpp:47); other skills pass other payloads. Read it as a level only
 *    for skills you know are buffs.
 *
 *  - `result` is sc_start()'s return for PR_KYRIE / PR_IMPOSITIO /
 *    PR_SUFFRAGIUM / PR_ASPERSIO, but a hardcoded true for AL_BLESSING and
 *    AL_INCAGI, which broadcast BEFORE calling sc_start. So `result === 0` is a
 *    definite failure, but `result === 1` only means the cast reached castend.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

export class CastState extends EventEmitter {
	install() {
		observePacket(PACKET.ZC.USE_SKILL, pkt => this._onUse(pkt));
		observePacket(PACKET.ZC.USE_SKILL2, pkt => this._onUse(pkt));
		return this;
	}

	_onUse(pkt) {
		this.emit('skillUsed', {
			skid: pkt.SKID,
			value: pkt.level,
			srcAid: pkt.srcAID,
			targetGid: pkt.targetAID,
			result: pkt.result
		});
	}
}
