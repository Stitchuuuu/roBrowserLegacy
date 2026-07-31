/**
 * Node/state/storage.js
 *
 * Kafra storage tracker — same shape as `state/homun.js`. Storage has no
 * client-initiated "open" packet: the server pushes the item list (and/or
 * the count info) when an NPC script opens it, so `open` flips true on the
 * first of either and false on CLOSE_STORE (see EXISTING.md's packet table).
 *
 * Same v1/v2+ casing gotcha as inventory.js: `pkt.itemInfo` (lowercase) on
 * STORE_NORMAL_ITEMLIST, `pkt.ItemInfo` (capital) on the …2/3/4 variants.
 * DELETE_ITEM_FROM_STORE uses lowercase `pkt.index`/`pkt.count` — unlike
 * inventory's DELETE_ITEM_FROM_BODY, which is capitalised.
 *
 * Item display names are not resolved — see inventory.js's note; same
 * reason (DB.getItemInfo pulls in browser-only deps).
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

export class StorageState extends EventEmitter {
	constructor() {
		super();
		this.byIndex = {}; // index → { index, itid, name, count, type }
		this.open = false;
	}

	install() {
		observePacket(PACKET.ZC.STORE_NORMAL_ITEMLIST, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.STORE_NORMAL_ITEMLIST2, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.STORE_NORMAL_ITEMLIST3, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));
		observePacket(PACKET.ZC.STORE_NORMAL_ITEMLIST4, pkt => this._onList(pkt.itemInfo || pkt.ItemInfo));

		observePacket(PACKET.ZC.NOTIFY_STOREITEM_COUNTINFO, () => this._onOpen());

		observePacket(PACKET.ZC.ADD_ITEM_TO_STORE, pkt => this._onAdd(pkt));
		observePacket(PACKET.ZC.ADD_ITEM_TO_STORE2, pkt => this._onAdd(pkt));

		observePacket(PACKET.ZC.DELETE_ITEM_FROM_STORE, pkt => this._onDelete(pkt.index, pkt.count));

		observePacket(PACKET.ZC.CLOSE_STORE, () => this._onClose());
		return this;
	}

	_onOpen() {
		if (!this.open) {
			this.open = true;
			this.emit('open');
		}
	}

	_onList(itemInfo) {
		if (!itemInfo) {
			return;
		}
		this._onOpen();
		this.byIndex = {};
		for (let i = 0, n = itemInfo.length; i < n; ++i) {
			const it = itemInfo[i];
			this.byIndex[it.index] = { index: it.index, itid: it.ITID, name: '', count: it.count, type: it.type };
		}
		this.emit('list');
	}

	_onAdd(pkt) {
		this._onOpen();
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

	_onClose() {
		this.open = false;
		this.byIndex = {};
		this.emit('close');
	}

	isOpen() {
		return this.open;
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
}
