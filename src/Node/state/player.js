/**
 * Node/state/player.js
 *
 * Local-player scalar tracker: HP / SP / zeny / weight / position from the parameter
 * packets, plus the base-stat block from ZC.STATUS. Fed only via
 * observePacket (never hookPacket — the handshake owns those slots).
 *
 * Value field differs by packet: PAR_CHANGE uses `count`, LONGPAR_CHANGE /
 * LONGLONGPAR_CHANGE use `amount` (mirrors Main.js:onParameterChange). The
 * varID enum is DB/Status/StatusProperty.js.
 *
 * Position (x/y, map cells) has no parameter packet — it is pieced together
 * from the spawn ack, the warp acks and our own walk/stop notifications. It
 * stays 0,0 until the first of those lands; callers must fail open on that.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import SP from 'DB/Status/StatusProperty.js';
import Session from 'Engine/SessionStorage.js';
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
		this.x = 0; // map cell — 0,0 means "not known yet", not the origin
		this.y = 0;
		this.stats = {};
	}

	install() {
		observePacket(PACKET.ZC.PAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.count));
		observePacket(PACKET.ZC.LONGPAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.amount));
		observePacket(PACKET.ZC.LONGLONGPAR_CHANGE, pkt => this._onParam(pkt.varID, pkt.amount));
		observePacket(PACKET.ZC.STATUS, pkt => this._onStatus(pkt));

		// Position. The spawn ack carries a packed PosDir; the warp acks carry
		// plain xPos/yPos; our own walk carries a start AND a destination cell —
		// we snap straight to the destination (we only need cell-accuracy, and
		// STOPMOVE corrects us on any interruption).
		observePacket(PACKET.ZC.ACCEPT_ENTER, pkt => this._onPosDir(pkt.PosDir));
		observePacket(PACKET.ZC.ACCEPT_ENTER2, pkt => this._onPosDir(pkt.PosDir));
		observePacket(PACKET.ZC.ACCEPT_ENTER3, pkt => this._onPosDir(pkt.PosDir));
		observePacket(PACKET.ZC.NPCACK_MAPMOVE, pkt => this._onPos(pkt.xPos, pkt.yPos));
		observePacket(PACKET.ZC.NPCACK_SERVERMOVE, pkt => this._onPos(pkt.xPos, pkt.yPos));
		observePacket(PACKET.ZC.NOTIFY_PLAYERMOVE, pkt => this._onMoveData(pkt.MoveData));
		// STOPMOVE is absolute and authoritative (clif_fixpos). Its `AID` field
		// is a block id, so ours is Session.AID — it also fires for other units.
		observePacket(PACKET.ZC.STOPMOVE, pkt => {
			if (pkt.AID === Session.AID) {
				this._onPos(pkt.xPos, pkt.yPos);
			}
		});
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

	// readPos() → [x, y, dir]
	_onPosDir(posDir) {
		if (posDir) {
			this._onPos(posDir[0], posDir[1]);
		}
	}

	// readPos2() → [x1, y1, x2, y2, subx, suby] — [2],[3] is the destination cell.
	_onMoveData(moveData) {
		if (moveData) {
			this._onPos(moveData[2], moveData[3]);
		}
	}

	_onPos(x, y) {
		if (this.x === x && this.y === y) {
			return;
		}
		this.x = x;
		this.y = y;
		this.emit('change', { field: 'pos', value: { x, y } });
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
