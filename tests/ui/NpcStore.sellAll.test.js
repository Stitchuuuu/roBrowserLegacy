/**
 * tests/ui/NpcStore.sellAll.test.js
 *
 * The "Sell all" button of the NPC sell window.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendPacket = vi.fn();
const inventory = {
	2: { index: 2, ITID: 501, type: 0, count: 30, IsIdentified: true },
	5: { index: 5, ITID: 1201, type: 4, count: 1, IsIdentified: true },
	9: { index: 9, ITID: 909, type: 3, count: 120, IsIdentified: true }
};

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({
	default: { INTERFACE_PATH: '', getItemInfo: () => ({}), getItemName: () => '', getMessage: () => '' }
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('Network/NetworkManager.js', () => ({ default: { sendPacket } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({
	default: { addComponent: c => c, getComponent: () => ({ name: 'InventoryV0' }) }
}));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: { addText: vi.fn(), TYPE: {}, FILTER: {} } }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({
	default: { getItemByIndex: index => inventory[index] }
}));

const NpcStore = (await import('UI/Components/NpcStore/NpcStore.js')).default;

/**
 * @param {string} side InputWindow or OutputWindow
 * @returns {Array} item indexes listed on that side
 */
function listed(side) {
	const items = NpcStore.getRoot().querySelectorAll(`.${side} .content .item`);
	return Array.from(items, item => Number(item.dataset.index));
}

describe('NpcStore sell all', () => {
	beforeAll(() => {
		NpcStore.prepare();
	});

	beforeEach(() => {
		sendPacket.mockClear();
	});

	it('moves every sellable stack to the selling list, without selling', () => {
		NpcStore.setType(NpcStore.Type.SELL);
		NpcStore.setList([
			{ index: 2, price: 10, overchargeprice: 10 },
			{ index: 5, price: 500, overchargeprice: 500 },
			{ index: 9, price: 3, overchargeprice: 3 }
		]);

		NpcStore.getRoot().querySelector('.sellall').click();

		expect(listed('InputWindow')).toEqual([]);
		expect(listed('OutputWindow')).toEqual([2, 5, 9]);
		expect(NpcStore.getRoot().querySelector('.OutputWindow .item[data-index="9"] .amount').textContent).toBe(
			'120'
		);
		expect(sendPacket).not.toHaveBeenCalled();
	});

	it('is shown in sell mode only', () => {
		const button = NpcStore.getRoot().querySelector('.sellall');

		NpcStore.setType(NpcStore.Type.SELL);
		expect(button.style.display).toBe('');

		NpcStore.setType(NpcStore.Type.BUY);
		expect(button.style.display).toBe('none');
	});
});
