/**
 * Node/state/party.js
 *
 * Party roster tracker, indexed AID → member. Fed via observePacket from
 * the roster variants (GROUP_LIST / _LIST2 / _LIST3 — only _LIST3 carries
 * a GID), live joins (ADD_MEMBER_TO_GROUP{,2,3,4}), absolute HP
 * (NOTIFY_HP_TO_GROUPM / _R2), and position (NOTIFY_POSITION_TO_GROUPM).
 *
 * The party protocol carries HP only — no SP for members (known limit).
 * `state` byte: 0 = online.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

function blankMember(aid) {
	return {
		aid,
		gid: 0,
		name: '',
		map: '',
		role: 0,
		state: 0,
		online: false,
		class_: 0,
		baseLevel: 0,
		hp: 0,
		maxhp: 0,
		x: 0,
		y: 0
	};
}

export class PartyState extends EventEmitter {
	constructor() {
		super();
		this.name = '';
		this.byAid = {}; // aid → member
	}

	install() {
		observePacket(PACKET.ZC.GROUP_LIST, pkt => this._onList(pkt));
		observePacket(PACKET.ZC.GROUP_LIST2, pkt => this._onList(pkt));
		observePacket(PACKET.ZC.GROUP_LIST3, pkt => this._onList(pkt));
		observePacket(PACKET.ZC.ADD_MEMBER_TO_GROUP, pkt => this._onAdd(pkt));
		observePacket(PACKET.ZC.ADD_MEMBER_TO_GROUP2, pkt => this._onAdd(pkt));
		observePacket(PACKET.ZC.ADD_MEMBER_TO_GROUP3, pkt => this._onAdd(pkt));
		observePacket(PACKET.ZC.ADD_MEMBER_TO_GROUP4, pkt => this._onAdd(pkt));
		observePacket(PACKET.ZC.NOTIFY_HP_TO_GROUPM, pkt => this._onHp(pkt));
		observePacket(PACKET.ZC.NOTIFY_HP_TO_GROUPM_R2, pkt => this._onHp(pkt));
		observePacket(PACKET.ZC.NOTIFY_POSITION_TO_GROUPM, pkt => this._onPos(pkt));
		return this;
	}

	_upsert(aid, patch) {
		let member = this.byAid[aid];
		if (!member) {
			member = this.byAid[aid] = blankMember(aid);
		}
		for (const k in patch) {
			if (patch[k] !== undefined) {
				member[k] = patch[k];
			}
		}
		return member;
	}

	// A full roster is authoritative: refresh known members, prune the rest,
	// preserve live HP/position already tracked for surviving members.
	_onList(pkt) {
		if (pkt.groupName) {
			this.name = pkt.groupName;
		}
		const info = pkt.groupInfo || [];
		const seen = {};
		for (let i = 0, n = info.length; i < n; ++i) {
			const e = info[i];
			const aid = e.AID;
			seen[aid] = true;
			this._upsert(aid, {
				gid: e.GID || 0,
				name: e.characterName,
				map: e.mapName,
				role: e.role,
				state: e.state,
				online: e.state === 0,
				class_: e.class_,
				baseLevel: e.baseLevel
			});
		}
		for (const aid in this.byAid) {
			if (!seen[aid]) {
				delete this.byAid[aid];
			}
		}
		this.emit('list', { name: this.name, members: this.getMembers() });
	}

	_onAdd(pkt) {
		const member = this._upsert(pkt.AID, {
			gid: pkt.GID || 0,
			name: pkt.characterName,
			map: pkt.mapName,
			role: pkt.role,
			state: pkt.state,
			online: pkt.state === 0,
			class_: pkt.class_,
			baseLevel: pkt.baseLevel,
			x: pkt.xPos,
			y: pkt.yPos
		});
		this.emit('member', member);
	}

	_onHp(pkt) {
		const member = this._upsert(pkt.AID, { hp: pkt.hp, maxhp: pkt.maxhp });
		this.emit('hp', { aid: pkt.AID, hp: member.hp, maxhp: member.maxhp });
	}

	_onPos(pkt) {
		this._upsert(pkt.AID, { x: pkt.xPos, y: pkt.yPos });
		this.emit('position', { aid: pkt.AID, x: pkt.xPos, y: pkt.yPos });
	}

	getMembers() {
		const out = [];
		for (const aid in this.byAid) {
			out.push(this.byAid[aid]);
		}
		return out;
	}

	getByAid(aid) {
		return this.byAid[aid] || null;
	}

	getByName(name) {
		const target = String(name).toLowerCase();
		for (const aid in this.byAid) {
			const member = this.byAid[aid];
			if (member.name && member.name.toLowerCase() === target) {
				return member;
			}
		}
		return null;
	}
}
