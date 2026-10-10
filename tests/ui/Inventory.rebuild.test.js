/**
 * tests/ui/Inventory.rebuild.test.js
 *
 * The inventory restarted in place by a map transition.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({
	default: { INTERFACE_PATH: '', getItemInfo: () => ({}), getItemName: () => '', getMessage: () => '' }
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Core/Configs.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('Network/NetworkManager.js', () => ({ default: { sendPacket: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/CartItems/CartItems.js', () => ({ default: {} }));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemCompare/ItemCompare.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: { addText: vi.fn(), TYPE: {} } }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: { getUI: () => ({ getNumber: () => 0 }) } }));
vi.mock('UI/Components/Storage/Storage.js', () => ({ default: {} }));
vi.mock('UI/Components/SwitchEquip/SwitchEquip.js', () => ({ default: {} }));
vi.mock('UI/Components/BasicInfo/BasicInfo.js', () => ({ default: { getUI: () => ({}) } }));
vi.mock('UI/Components/Refine/Refine.js', () => ({ default: {} }));
vi.mock('UI/Components/EnchantGrade/EnchantGrade.js', () => ({ default: {} }));
vi.mock('UI/Components/Enchant/Enchant.js', () => ({ default: {} }));
vi.mock('UI/Components/Mail/Mail.js', () => ({ default: {} }));
vi.mock('UI/Components/Rodex/WriteRodex.js', () => ({ default: {} }));

const Inventory = (await import('UI/Components/Inventory/InventoryV0/InventoryV0.js')).default;

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

function fill() {
	Inventory.list.length = 0;
	Inventory.list.push({ index: 2, ITID: 501, count: 1 });
	Inventory.getRoot().querySelector('.container .content').innerHTML = '<div class="item" data-index="2"></div>';
}

/**
 * The server sends the inventory again once the map is loaded, and that list
 * replaces the items by index: emptying it at the transition wiped what had
 * already arrived when the packet went out before the fade.
 */
describe('Inventory rebuilt in place by a map transition', () => {
	beforeAll(() => {
		Inventory.append();
	});

	it('keeps its items', () => {
		fill();

		Inventory.onRemove(true);

		expect(Inventory.list).toHaveLength(1);
		expect(Inventory.getRoot().querySelectorAll('.content .item')).toHaveLength(1);
	});

	it('still empties when it is removed', () => {
		fill();

		Inventory.onRemove();

		expect(Inventory.list).toHaveLength(0);
		expect(Inventory.getRoot().querySelectorAll('.content .item')).toHaveLength(0);
	});
});
