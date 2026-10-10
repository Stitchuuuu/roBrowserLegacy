/**
 * tests/ui/CartItems.rebuild.test.js
 *
 * The cart window restarted in place by a map transition.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const reqMoveItemToCart = vi.fn();

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({
	default: { INTERFACE_PATH: '', getItemInfo: () => ({}), getItemName: () => '', getMessage: () => '' }
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('Engine/SessionStorage.js', () => ({ default: { Entity: { hasCart: true } } }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemCompare/ItemCompare.js', () => ({ default: {} }));
vi.mock('UI/Components/Storage/Storage.js', () => ({ default: { reqMoveItemToCart: vi.fn() } }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: { getUI: () => ({ reqMoveItemToCart }) } }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: {} }));

const CartItems = (await import('UI/Components/CartItems/CartItems.js')).default;

function fill() {
	CartItems.list.length = 0;
	CartItems.list.push({ index: 2, ITID: 501, count: 1 });
	CartItems.getRoot().querySelector('.container .content').innerHTML = '<div class="item" data-index="2"></div>';
}

/**
 * The server sends the cart again once the map is loaded, and that list
 * replaces the items by index: emptying it at the transition only showed a
 * blank grid until then.
 */
describe('CartItems rebuilt in place by a map transition', () => {
	beforeAll(() => {
		CartItems.append();
	});

	it('keeps its items', () => {
		fill();

		CartItems.onRemove(true);

		expect(CartItems.list).toHaveLength(1);
		expect(CartItems.getRoot().querySelectorAll('.content .item')).toHaveLength(1);
	});

	it('still empties when it is removed', () => {
		fill();

		CartItems.onRemove();

		expect(CartItems.list).toHaveLength(0);
		expect(CartItems.getRoot().querySelectorAll('.content .item')).toHaveLength(0);
	});
});
