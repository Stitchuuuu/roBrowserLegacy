/**
 * tests/ui/CartItems.preferences.test.js
 *
 * Cart Items window size, position and reduce state saved to preferences.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prefs = vi.hoisted(() => ({ save: null }));

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({
	default: { INTERFACE_PATH: '', getItemInfo: () => ({}), getItemName: () => '', getMessage: () => '' }
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => Object.assign(prefs, defaults) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: { Entity: { hasCart: true } } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemCompare/ItemCompare.js', () => ({ default: {} }));
vi.mock('UI/Components/Storage/Storage.js', () => ({ default: {} }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: {} }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: {} }));

const Mouse = (await import('Controls/MouseEventHandler.js')).default;
const CartItems = (await import('UI/Components/CartItems/CartItems.js')).default;

/**
 * @param {string} selector button inside the window
 * @param {string} type event name
 */
function press(selector, type) {
	CartItems.getRoot().querySelector(selector).dispatchEvent(new Event(type));
}

/**
 * Drag the resize grip to a size, then release it
 *
 * @param {number} width columns
 * @param {number} height rows
 */
function dragGrip(width, height) {
	press('.footer .extend', 'mousedown');
	Mouse.screen.x = CartItems._host.offsetLeft + 25 + width * 32;
	Mouse.screen.y = CartItems._host.offsetTop + 20 + height * 32;
	vi.advanceTimersByTime(30);
	const up = new Event('mouseup');
	Object.defineProperty(up, 'which', { value: 1 });
	window.dispatchEvent(up);
}

describe('CartItems preferences', () => {
	beforeAll(() => {
		CartItems.prepare();
	});

	beforeEach(() => {
		vi.useFakeTimers();
		Object.assign(prefs, { x: 200, y: 200, width: 7, height: 4, show: true, reduce: false, save: vi.fn() });
		CartItems._host.style.display = '';
		CartItems.append();
	});

	afterEach(() => {
		CartItems.remove();
		vi.useRealTimers();
	});

	it('saves the resized window when it is closed', () => {
		dragGrip(9, 6);
		CartItems._host.style.left = '300px';
		CartItems._host.style.top = '150px';
		prefs.save.mockClear();

		press('.titlebar .close', 'click');

		expect(prefs).toMatchObject({ x: 300, y: 150, width: 9, height: 6, show: false });
		expect(prefs.save).toHaveBeenCalled();
	});

	it('saves the new size at the end of a resize', () => {
		dragGrip(6, 2);

		expect(prefs).toMatchObject({ width: 6, height: 2 });
		expect(prefs.save).toHaveBeenCalled();
	});

	it('keeps the size of a closed window when the map changes', () => {
		CartItems.resize(8, 5);
		press('.titlebar .close', 'click');

		CartItems.remove();

		expect(prefs).toMatchObject({ width: 8, height: 5, show: false });
	});

	it('keeps the rows of a reduced window', () => {
		CartItems.resize(8, 5);
		press('.titlebar .mini', 'click');

		press('.titlebar .close', 'click');

		expect(prefs).toMatchObject({ width: 8, height: 5, reduce: true });
	});

	it('restores a reduced window', () => {
		CartItems.remove();
		prefs.reduce = true;

		CartItems.append();

		expect(CartItems._host.style.height).toBe('17px');
	});

	it('reduces a restored window on the first click', () => {
		CartItems.remove();
		// Layout as a browser would give it, none when hidden
		const host = CartItems._host;
		const rect = vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => {
			const shown = host.style.display !== 'none';
			return { width: shown ? parseInt(host.style.width, 10) : 0, height: shown ? parseInt(host.style.height, 10) : 0 };
		});
		CartItems.append();

		press('.titlebar .mini', 'click');

		expect(host.style.height).toBe('17px');
		rect.mockRestore();
	});

	it('reopens at the saved size', () => {
		CartItems.remove();
		Object.assign(prefs, { width: 9, height: 6 });
		const resize = vi.spyOn(CartItems, 'resize');

		CartItems.append();

		expect(resize).toHaveBeenCalledWith(9, 6);
		resize.mockRestore();
	});
});
