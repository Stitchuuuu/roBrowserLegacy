/**
 * Node/api/Player.js
 *
 * Friendly view over PlayerState. Getters read live tracker fields and
 * on()/off() forward to the tracker's EventEmitter ('hp' | 'sp' | 'change');
 * moveTo() sends the walk request, gated on the tracked position so a
 * redundant "already there" move never hits the wire.
 */
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';

export class Player {
	constructor(state) {
		this._s = state;
	}

	get hp() {
		return this._s.hp;
	}
	get maxhp() {
		return this._s.maxhp;
	}
	get sp() {
		return this._s.sp;
	}
	get maxsp() {
		return this._s.maxsp;
	}
	get zeny() {
		return this._s.zeny;
	}
	get weight() {
		return this._s.weight;
	}
	get maxweight() {
		return this._s.maxweight;
	}
	// Map cell. 0,0 = not known yet (no spawn/warp/move ack seen), not the origin.
	get x() {
		return this._s.x;
	}
	get y() {
		return this._s.y;
	}
	get stats() {
		return this._s.stats;
	}

	on(event, cb) {
		this._s.on(event, cb);
		return this;
	}
	off(event, cb) {
		this._s.off(event, cb);
		return this;
	}

	/**
	 * Request a walk to a map cell. Fire-and-return — arrival is the caller's
	 * job to await via waitFor(client, 'change', e => e.field === 'pos' &&
	 * e.value.x === x && e.value.y === y), the event PlayerState already fires.
	 *
	 * @param {number} x target cell
	 * @param {number} y target cell
	 * @returns {{sent: boolean, reason?: string, x?: number, y?: number}}
	 */
	moveTo(x, y) {
		if (this._s.x === x && this._s.y === y) {
			return { sent: false, reason: 'already there' };
		}
		const pkt = PACKETVER.value >= 20180307 ? new PACKET.CZ.REQUEST_MOVE2() : new PACKET.CZ.REQUEST_MOVE();
		pkt.dest = [x, y];
		Network.sendPacket(pkt);
		return { sent: true, x, y };
	}
}
