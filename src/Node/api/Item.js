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
	 * Use a consumable by inventory slot index, item id (ITID), or name. A number
	 * is tried as a held slot first, then as an item id (the id `/inventory`
	 * prints, e.g. 602 = Butterfly Wing); name is best-effort — InventoryState's
	 * `name` is usually empty headless, so it can miss even for a held item.
	 *
	 * @param {number|string} target
	 * @returns {{sent: boolean, reason?: string, index?: number}}
	 */
	use(target) {
		let index;
		if (typeof target === 'string') {
			index = this._s.findByName(target);
		} else if (this._s.get(target)) {
			index = target; // a held slot
		} else {
			index = this._s.findByItid(target); // not a slot — read the number as an item id
		}
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
