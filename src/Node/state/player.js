/**
 * Node/state/player.js
 *
 * Local-player scalar tracker: HP / SP / zeny / weight from the parameter
 * packets, plus the base-stat block from ZC.STATUS. Fed only via
 * observePacket (never hookPacket — the handshake owns those slots).
 *
 * Value field differs by packet: PAR_CHANGE uses `count`, LONGPAR_CHANGE /
 * LONGLONGPAR_CHANGE use `amount` (mirrors Main.js:onParameterChange). The
 * varID enum is DB/Status/StatusProperty.js.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import SP from 'DB/Status/StatusProperty.js';
import { observePacket } from '../net/observe.js';

export class PlayerState extends EventEmitter {
	constructor() {
		super();
		this.hp = 0;
		this.maxhp = 0;
		this.sp = 0;
		this.maxsp = 0;
		this.zeny = 0;
		this.weight = 0;
		this.maxweight = 0;
		this.stats = {};
	}

	install() {
		observePacket(PACKET.ZC.PAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.count));
		observePacket(PACKET.ZC.LONGPAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.amount));
		observePacket(PACKET.ZC.LONGLONGPAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.amount));
		observePacket(PACKET.ZC.STATUS, pkt => this._onStatus(pkt));
		return this;
	}

	_onParam(varID, value) {
		// int64 amounts (zeny/exp) come back as BigInt — narrow to Number.
		const v = typeof value === 'bigint' ? Number(value) : value;
		switch (varID) {
			case SP.HP:
				this.hp = v;
				this.emit('hp', { hp: this.hp, maxhp: this.maxhp });
				break;
			case SP.MAXHP:
				this.maxhp = v;
				this.emit('hp', { hp: this.hp, maxhp: this.maxhp });
				break;
			case SP.SP:
				this.sp = v;
				this.emit('sp', { sp: this.sp, maxsp: this.maxsp });
				break;
			case SP.MAXSP:
				this.maxsp = v;
				this.emit('sp', { sp: this.sp, maxsp: this.maxsp });
				break;
			case SP.MONEY:
				this.zeny = v;
				this.emit('change', { field: 'zeny', value: v });
				break;
			case SP.WEIGHT:
				this.weight = v;
				this.emit('change', { field: 'weight', value: v });
				break;
			case SP.MAXWEIGHT:
				this.maxweight = v;
				this.emit('change', { field: 'maxweight', value: v });
				break;
			default:
				break;
		}
	}

	_onStatus(pkt) {
		const stats = this.stats;
		stats.str = pkt.str;
		stats.agi = pkt.agi;
		stats.vit = pkt.vit;
		stats.int = pkt.Int;
		stats.dex = pkt.dex;
		stats.luk = pkt.luk;
		stats.atk = pkt.attPower;
		stats.matkMax = pkt.max_mattPower;
		stats.matkMin = pkt.min_mattPower;
		stats.hit = pkt.hitSuccessValue;
		stats.flee = pkt.avoidSuccessValue;
		stats.crit = pkt.criticalSuccessValue;
		stats.aspd = pkt.ASPD;
		this.emit('change', { field: 'stats', value: stats });
	}
}
