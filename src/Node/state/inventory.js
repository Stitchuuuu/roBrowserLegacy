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
 *
 * Consuming an item does NOT produce a delete packet: pc_useitem acks with
 * clif_useitemack and then calls pc_delitem(…, type=1, …), whose `if(!(type&1))`
 * gate suppresses clif_delitem (rathena src/map/pc.cpp:6534-6536 and :6120).
 * ZC.USE_ITEM_ACK{,2} is therefore the only signal that a use landed — it
 * carries the REMAINING count, so it is also the only thing that keeps a slot's
 * count honest after a use. Mirrors Engine/MapEngine/Item.js:737-738, which
 * hooks both variants; only ACK2 carries an AID to filter on.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import Session from 'Engine/SessionStorage.js';
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

		// The 2018+ split wrapper (0xb09) is what the server actually sends at
		// PACKETVER 20211103 — one packet multiplexed by invType (0=inventory,
		// 1=cart, 2=storage). Filter to inventory: _onList resets byIndex, so an
		// unfiltered hook would let a cart/storage push clobber the inventory.
		observePacket(PACKET.ZC.SPLIT_SEND_ITEMLIST_NORMAL, pkt => {
			if (pkt.invType === 0) {
				this._onList(pkt.itemInfo || pkt.ItemInfo);
			}
		});

		observePacket(PACKET.ZC.ITEM_PICKUP_ACK, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK2, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK3, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK5, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK6, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK7, pkt => this._onPickup(pkt));
		observePacket(PACKET.ZC.ITEM_PICKUP_ACK8, pkt => this._onPickup(pkt));

		observePacket(PACKET.ZC.DELETE_ITEM_FROM_BODY, pkt => this._onDelete(pkt.Index, pkt.Count));

		observePacket(PACKET.ZC.USE_ITEM_ACK, pkt => this._onUse(pkt));
		observePacket(PACKET.ZC.USE_ITEM_ACK2, pkt => this._onUse(pkt));
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

	// `count` is what REMAINS after the use, and `result` is the server's ok/fail
	// (a refused use acks with count 0 / result false — pc.cpp:6539). Only ACK2
	// carries an AID; the older ACK has none, so filter only when it is present.
	_onUse(pkt) {
		if (pkt.AID != null && pkt.AID !== Session.AID) {
			return;
		}
		const ok = !!pkt.result;
		if (ok) {
			const existing = this.byIndex[pkt.index];
			if (existing) {
				existing.count = pkt.count;
				if (existing.count <= 0) {
					delete this.byIndex[pkt.index];
				}
			}
		}
		this.emit('use', { index: pkt.index, count: pkt.count, ok });
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

	/**
	 * @param {number} itid item template id (ITID) — the id `/inventory` prints
	 * @returns {?number} the first slot holding it, or null
	 */
	findByItid(itid) {
		for (const index in this.byIndex) {
			if (this.byIndex[index].itid === itid) {
				return Number(index);
			}
		}
		return null;
	}
}
