/**
 * Node/api/Item.js
 *
 * Item-use façade over InventoryState. Resolves a slot index (or a best-effort
 * name — InventoryState's `name` is often empty, see state/inventory.js), gates
 * on the slot being held, then sends CZ.USE_ITEM2 (or the older CZ.USE_ITEM).
 * Same shape as api/Skill.js.
 *
 * pkt.AID is Session.AID — the browser reference (MapEngine.js) reads it from
 * Session.Entity.GID, but Session.Entity is null headless (see api/messages.js
 * and resolve/targets.js), so every Node sender identifies self by Session.AID.
 *
 * on()/off() delegate read events ('list'|'add'|'remove') to the tracker; the
 * façade's own 'blocked' event lives on its own emitter (RoClient consolidates).
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';
import Session from 'Engine/SessionStorage.js';

export class Item extends EventEmitter {
	constructor(inventoryState) {
		super();
		this._s = inventoryState;
	}

	list() {
		return this._s.list();
	}
	get(index) {
		return this._s.get(index);
	}
	findByName(name) {
		return this._s.findByName(name);
	}

	on(event, cb) {
		if (event === 'blocked') {
			super.on(event, cb);
		} else {
			this._s.on(event, cb);
		}
		return this;
	}
	off(event, cb) {
		if (event === 'blocked') {
			super.off(event, cb);
		} else {
			this._s.off(event, cb);
		}
		return this;
	}

	/**
	 * Use a consumable by inventory slot index, or by name (best-effort — the
	 * name lookup can legitimately miss even for a held item).
	 *
	 * @param {number|string} indexOrName
	 * @returns {{sent: boolean, reason?: string, index?: number}}
	 */
	use(indexOrName) {
		const index = typeof indexOrName === 'string' ? this._s.findByName(indexOrName) : indexOrName;
		if (index == null || !this._s.get(index)) {
			const reason = 'not in inventory';
			this.emit('blocked', { reason });
			return { sent: false, reason };
		}
		const pkt = PACKETVER.value >= 20180307 ? new PACKET.CZ.USE_ITEM2() : new PACKET.CZ.USE_ITEM();
		pkt.index = index;
		pkt.AID = Session.AID;
		Network.sendPacket(pkt);
		return { sent: true, index };
	}
}
