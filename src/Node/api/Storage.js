/**
 * Node/api/Storage.js
 *
 * Kafra storage move façade. Wraps both StorageState and InventoryState —
 * deposit resolves an *inventory* slot (the source), withdraw a *storage* slot.
 * Every method gates on StorageState.isOpen(); close() only sends the request
 * (CZ.CLOSE_STORE) and never hand-sets `open` — the server's ZC.CLOSE_STORE
 * echo flips it via StorageState._onClose(), keeping one source of truth.
 * Same shape as api/Skill.js.
 *
 * on()/off() delegate read events ('open'|'close'|'list'|'add'|'remove') to
 * StorageState; the façade's own 'blocked' event lives on its own emitter
 * (RoClient consolidates it onto the flat 'blocked' stream).
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';

export class Storage extends EventEmitter {
	constructor(storageState, inventoryState) {
		super();
		this._storage = storageState;
		this._inv = inventoryState;
	}

	isOpen() {
		return this._storage.isOpen();
	}
	list() {
		return this._storage.list();
	}

	on(event, cb) {
		if (event === 'blocked') {
			super.on(event, cb);
		} else {
			this._storage.on(event, cb);
		}
		return this;
	}
	off(event, cb) {
		if (event === 'blocked') {
			super.off(event, cb);
		} else {
			this._storage.off(event, cb);
		}
		return this;
	}

	/**
	 * Move an item from inventory into open storage.
	 *
	 * @param {number|string} indexOrName inventory slot index, or best-effort name
	 * @param {number} [count] defaults to the whole stack in that slot
	 * @returns {{sent: boolean, reason?: string, index?: number, count?: number}}
	 */
	deposit(indexOrName, count) {
		return this._move(this._inv, indexOrName, count, 'not in inventory', () =>
			PACKETVER.value >= 20180307
				? new PACKET.CZ.MOVE_ITEM_FROM_BODY_TO_STORE2()
				: new PACKET.CZ.MOVE_ITEM_FROM_BODY_TO_STORE()
		);
	}

	/**
	 * Move an item from open storage into inventory.
	 *
	 * @param {number|string} indexOrName storage slot index, or best-effort name
	 * @param {number} [count] defaults to the whole stack in that slot
	 * @returns {{sent: boolean, reason?: string, index?: number, count?: number}}
	 */
	withdraw(indexOrName, count) {
		return this._move(this._storage, indexOrName, count, 'not in storage', () =>
			PACKETVER.value >= 20180307
				? new PACKET.CZ.MOVE_ITEM_FROM_STORE_TO_BODY2()
				: new PACKET.CZ.MOVE_ITEM_FROM_STORE_TO_BODY()
		);
	}

	/**
	 * Request storage close. The request only — `open` flips when the server's
	 * ZC.CLOSE_STORE echoes back (StorageState._onClose).
	 *
	 * @returns {{sent: boolean, reason?: string}}
	 */
	close() {
		if (!this._storage.isOpen()) {
			return this._blocked('storage not open');
		}
		Network.sendPacket(new PACKET.CZ.CLOSE_STORE());
		return { sent: true };
	}

	/**
	 * Shared gate → resolve source slot → build packet → send. `source` is the
	 * state the item currently lives in (inventory for deposit, storage for
	 * withdraw); `count` defaults to that slot's held stack. Refuses unless the
	 * resolved slot is actually held — otherwise a bad index/id would report a
	 * bogus success and put a no-op move on the wire.
	 */
	_move(source, target, count, missReason, build) {
		if (!this._storage.isOpen()) {
			return this._blocked('storage not open');
		}
		const index = this._resolve(source, target);
		const slot = index == null ? null : this._slot(source, index);
		if (!slot) {
			return this._blocked(missReason);
		}
		const n = count != null ? count : slot.count;
		const pkt = build();
		pkt.index = index;
		pkt.count = n;
		Network.sendPacket(pkt);
		return { sent: true, index, count: n };
	}

	// Resolve a name / item id / slot index against `source` to a slot index. A
	// number is tried as a held slot first, then as an item id (what /storage
	// list and /inventory print); a string is a best-effort name.
	_resolve(source, target) {
		if (typeof target === 'string') {
			return source.findByName(target);
		}
		const num = Number(target);
		if (Number.isNaN(num)) {
			return null;
		}
		if (this._slot(source, num)) {
			return num;
		}
		return source.findByItid(num);
	}

	// Find a slot in a source's list() by index (StorageState has no get()).
	_slot(source, index) {
		const items = source.list();
		for (let i = 0, len = items.length; i < len; ++i) {
			if (items[i].index === index) {
				return items[i];
			}
		}
		return null;
	}

	_blocked(reason) {
		this.emit('blocked', { reason });
		return { sent: false, reason };
	}
}
