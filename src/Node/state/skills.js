/**
 * Node/state/skills.js
 *
 * Skill-list tracker, indexed SKID → skill. cyro serves ZC.SKILLINFO_LIST2
 * (0xb32), which omits `skillName` — the name is resolved from the SKID via
 * resolve/skills.js. Keying by SKID makes repeated chunks idempotent.
 *
 * ADD_SKILL{,2,3} nest their fields under `pkt.data`; the list and update
 * packets carry them top-level.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';
import { skillName } from '../resolve/skills.js';

export class SkillState extends EventEmitter {
	constructor() {
		super();
		this.bySkid = {}; // skid → { skid, level, spcost, range, upgradable, name }
	}

	install() {
		observePacket(PACKET.ZC.SKILLINFO_LIST, pkt => this._onList(pkt));
		observePacket(PACKET.ZC.SKILLINFO_LIST2, pkt => this._onList(pkt));
		observePacket(PACKET.ZC.ADD_SKILL, pkt => this._onSingle(pkt.data));
		observePacket(PACKET.ZC.ADD_SKILL2, pkt => this._onSingle(pkt.data));
		observePacket(PACKET.ZC.ADD_SKILL3, pkt => this._onSingle(pkt.data));
		observePacket(PACKET.ZC.SKILLINFO_UPDATE, pkt => this._onSingle(pkt));
		observePacket(PACKET.ZC.SKILLINFO_UPDATE2, pkt => this._onSingle(pkt));
		observePacket(PACKET.ZC.SKILLINFO_UPDATE3, pkt => this._onSingle(pkt));
		return this;
	}

	_store(raw) {
		const skid = raw.SKID;
		if (!skid) {
			return null;
		}
		const skill = {
			skid,
			level: raw.level,
			spcost: raw.spcost,
			range: raw.attackRange,
			upgradable: !!raw.upgradable,
			name: raw.skillName || skillName(skid)
		};
		this.bySkid[skid] = skill;
		return skill;
	}

	_onList(pkt) {
		const list = pkt.skillList || [];
		for (let i = 0, n = list.length; i < n; ++i) {
			this._store(list[i]);
		}
		this.emit('list', this.getSkills());
	}

	_onSingle(raw) {
		if (!raw) {
			return;
		}
		const skill = this._store(raw);
		if (skill) {
			this.emit('skill', skill);
		}
	}

	getSkills() {
		const out = [];
		for (const skid in this.bySkid) {
			out.push(this.bySkid[skid]);
		}
		return out;
	}

	get(skid) {
		return this.bySkid[skid] || null;
	}
}
