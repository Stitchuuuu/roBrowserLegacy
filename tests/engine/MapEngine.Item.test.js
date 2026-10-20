import { beforeEach, describe, expect, it, vi } from 'vitest';

// The packet handlers in Engine/MapEngine/Item.js are module-private and are
// only reachable through the hooks ItemEngine() registers.
const mocks = vi.hoisted(() => ({
	hooks: new Map(),
	chat: vi.fn(),
	inventory: {},
	equipment: {}
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: vi.fn()
	}
}));

vi.mock('DB/DBManager.js', () => ({
	default: {
		getMessage: id => 'MSG' + id + ' %s %d',
		getItemInfo: id => ({ identifiedDisplayName: 'Item' + id }),
		getItemName: item => 'Name' + item.ITID
	}
}));

vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: {
		addText: (...args) => mocks.chat(...args),
		TYPE: { ERROR: 1, BLUE: 2, INFO: 4, PUBLIC: 8 },
		FILTER: { PUBLIC_LOG: 0, ITEM: 5, EQUIP_DAMAGE: 13 }
	}
}));

vi.mock('UI/Components/Inventory/Inventory.js', () => ({
	default: { getItemByIndex: index => mocks.inventory[index] || null }
}));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({
	default: {
		getItemByLocation: location => {
			for (const key in mocks.equipment) {
				if (key & location) {
					return mocks.equipment[key];
				}
			}
			return null;
		}
	}
}));

// UI modules the engine imports but these handlers never reach.
vi.mock('Core/Configs.js', () => ({ default: { get: (_k, d) => d } }));
vi.mock('Renderer/ItemObject.js', () => ({ default: {} }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: {} }));
vi.mock('Renderer/EffectManager.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemObtain/ItemObtain.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemSelection/ItemSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/CartItems/CartItems.js', () => ({ default: {} }));
vi.mock('UI/Components/PlayerViewEquip/PlayerViewEquip.js', () => ({ default: {} }));
vi.mock('UI/Components/SwitchEquip/SwitchEquip.js', () => ({ default: {} }));
vi.mock('UI/Components/Storage/Storage.js', () => ({ default: {} }));
vi.mock('UI/Components/MakeItemSelection/MakeItemSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/MakeItemSelection/ItemListWindowSelection.js', () => ({ default: {} }));

const ItemEngine = (await import('Engine/MapEngine/Item.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;
const Session = (await import('Engine/SessionStorage.js')).default;

/** Invoke the handler ItemEngine() hooked for a given packet structure. */
function deliver(struct, fields) {
	const handler = mocks.hooks.get(struct);
	if (!handler) {
		throw new Error('no handler hooked for that packet');
	}
	const pkt = Object.create(struct.prototype);
	Object.assign(pkt, fields);
	handler(pkt);
	return pkt;
}

beforeEach(() => {
	mocks.hooks.clear();
	mocks.chat.mockClear();
	mocks.inventory = {};
	mocks.equipment = {};
	Session.AID = 2000000;
	ItemEngine();
});

describe('equipment damaged notice', () => {
	it('names the damaged piece of our own equipment in red', () => {
		mocks.equipment[2] = { ITID: 1201 };
		deliver(PACKET.ZC.EQUIPITEM_DAMAGED, { wearLocation: 2, accountID: 2000000 });
		expect(mocks.chat).toHaveBeenCalledWith('MSG1300 Name1201 %d', 1, 13, '#FF0000');
	});

	it('stays silent for another player or an empty slot', () => {
		mocks.equipment[2] = { ITID: 1201 };
		deliver(PACKET.ZC.EQUIPITEM_DAMAGED, { wearLocation: 2, accountID: 2000001 });
		deliver(PACKET.ZC.EQUIPITEM_DAMAGED, { wearLocation: 16, accountID: 2000000 });
		deliver(PACKET.ZC.EQUIPITEM_DAMAGED, { wearLocation: 0, accountID: 2000000 });
		expect(mocks.chat).not.toHaveBeenCalled();
	});
});

describe('item repair result', () => {
	it('reports a success in cyan', () => {
		deliver(PACKET.ZC.ACK_ITEMREPAIR, { index: 5, result: 0 });
		expect(mocks.chat).toHaveBeenCalledWith('MSG813 %s %d', 2, 0, '#00FFFF');
	});

	it('reports a failure in red', () => {
		deliver(PACKET.ZC.ACK_ITEMREPAIR, { index: 5, result: 1 });
		expect(mocks.chat).toHaveBeenCalledWith('MSG814 %s %d', 1, 0, '#FF0000');
	});
});

describe('upgrade weapon result', () => {
	it.each([
		[0, 'MSG911 Item1201 %d', '#00FFFF'],
		[1, 'MSG912 Item1201 %d', '#00CDCD'],
		[2, 'MSG913 Item1201 %d', '#FFC8C8'],
		[3, 'MSG914 Item1201 %d', '#FFC8C8']
	])('result %i shows its message with the item name', (msg, text, color) => {
		deliver(PACKET.ZC.ACK_WEAPONREFINE, { msg, ITID: 1201 });
		expect(mocks.chat).toHaveBeenCalledWith(text, expect.any(Number), 0, color);
	});

	it('ignores an unknown result', () => {
		deliver(PACKET.ZC.ACK_WEAPONREFINE, { msg: 4, ITID: 1201 });
		expect(mocks.chat).not.toHaveBeenCalled();
	});
});

describe('bind on equip notice', () => {
	it('names the item and flags it as bound', () => {
		const item = { index: 7, ITID: 2301, bindOnEquipType: 1 };
		mocks.inventory[7] = item;
		deliver(PACKET.ZC.NOTIFY_BIND_ON_EQUIP, { index: 7 });
		expect(mocks.chat).toHaveBeenCalledWith('MSG1328 Name2301 %d', 2, 5, '#FFFF6E');
		expect(item.bindOnEquipType).toBe(2);
	});

	it('stays silent when the item is unknown', () => {
		deliver(PACKET.ZC.NOTIFY_BIND_ON_EQUIP, { index: 9 });
		expect(mocks.chat).not.toHaveBeenCalled();
	});
});
