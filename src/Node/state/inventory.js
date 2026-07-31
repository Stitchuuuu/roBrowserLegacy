/**
 * Node/state/inventory.js
 *
 * Inventory tracker — same shape as `state/homun.js`: an additive
 * `observePacket` tap kept in an object indexed by the wire's own key
 * (here `index`, the inventory slot), no name resolution beyond what the
 * wire gives us.
 *
 * Two casing gotchas on the list packets: v1 (NORMAL_ITEMLIST) exposes
 * `pkt.itemInfo` (lowercase), v2/3/4 expose `pkt.ItemInfo` (capital) — read
 * `pkt.itemInfo || pkt.ItemInfo`. The single-item remove packet
 * (DELETE_ITEM_FROM_BODY) uses capital `pkt.Index` / `pkt.Count`, unlike its
 * storage counterpart (see storage.js).
 *
 * Item display names are NOT resolved here: `DB.getItemInfo()` (the browser
 * lookup, DBManager.js) pulls in Core/Client.js + Network's WebSocket shim —
 * not Node-safe. `name` is left best-effort (empty unless a future session
 * ports a Node-safe name table).
 *
 * Single-item add is ZC.ITEM_PICKUP_ACK(+2/3/5/6/7/8) — there is no
 * ZC.ADD_ITEM/ITEM_ADD. All six variants share `index`/`count`/`ITID`/
 * `result`; `result === 0` is success (mirrors Engine/MapEngine/Item.js's
 * onItemPickAnswer hook list).
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

export class InventoryState extends EventEmitter {
	constructor() {
		super();
		this.byIndex = {}; // index → { index, itid, name, count, type }
	}

	install() {
		observePacket(PACKET.ZC.NORMAL_ITEMLIST, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.NORMAL_ITEMLIST2, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.NORMAL_ITEMLIST3, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.NORMAL_ITEMLIST4, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));

		observePacket(PACKET.ZC.ITEM_PICKUP_ACK, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK2, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK3, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK5, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK6, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK7, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK8, pkt => this._onPickup(pkt));

		observePacket(PACKET.ZC.DELETE_ITEM_FROM_BODY, pkt => this._onDelete(pkt.Index, pkt.Count));
		return this;
	}

	_onList(itemInfo) {
		if (!itemInfo) {
			return;
		}
		this.byIndex = {};
		for (let i = 0, n = itemInfo.length; i < n; ++i) {
			const it = itemInfo[i];
			this.byIndex[it.index] = { index: it.index, itid: it.ITID, name: '', count: it.count, type: it.type };
		}
		this.emit('list');
	}

	_onPickup(pkt) {
		if (pkt.result !== 0) {
			return;
		}
		const existing = this.byIndex[pkt.index];
		if (existing) {
			existing.count += pkt.count;
		} else {
			this.byIndex[pkt.index] = {
				index: pkt.index,
				itid: pkt.ITID,
				name: '',
				count: pkt.count,
				type: pkt.type || 0
			};
		}
		this.emit('add', { index: pkt.index });
	}

	_onDelete(index, count) {
		const existing = this.byIndex[index];
		if (!existing) {
			return;
		}
		existing.count -= count;
		if (existing.count <= 0) {
			delete this.byIndex[index];
		}
		this.emit('remove', { index });
	}

	/**
	 * @returns {Array<{index: number, itid: number, name: string, count: number, type: number}>}
	 */
	list() {
		const out = [];
		for (const index in this.byIndex) {
			out.push(this.byIndex[index]);
		}
		return out;
	}

	get(index) {
		return this.byIndex[index] || null;
	}

	/**
	 * @param {string} name best-effort — matches only if `name` was populated
	 * @returns {?number} slot index, or null if not found
	 */
	findByName(name) {
		for (const index in this.byIndex) {
			if (this.byIndex[index].name === name) {
				return Number(index);
			}
		}
		return null;
	}
}
