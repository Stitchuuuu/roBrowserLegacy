/**
 * tests/plugins/LegacyUIComponent.viewport.test.js
 *
 * A plugin window on the old `(name, html, css)` contract keeps its position
 * on the host: a resize clamps the host, not the rendered root inside it, and
 * a window opening off-screen goes back where it first opened.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('UI/CursorManager.js', () => ({
	default: { ACTION: { DEFAULT: 0 }, getActualType: vi.fn(() => 0), setType: vi.fn() }
}));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '' } }));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile(_path, callback) {
			callback?.('');
		},
		loadFiles(_paths, callback) {
			callback?.('', '');
		}
	}
}));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));

const LegacyUIComponent = (await import('Plugins/native-manager/legacy-ui-component.js')).default;
const UIManager = (await import('UI/UIManager.js')).default;

afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

const WIDTH = 300;
const HEIGHT = 100;

/**
 * jsdom has no layout: give the host and its root a 300×100 box placed by
 * their inline left / top, the root offset by its own left inside the host.
 */
function layOut(component) {
	const host = component._host;
	const root = component.ui[0];
	const box = (x, y) => ({ x, y, left: x, top: y, width: WIDTH, height: HEIGHT, right: x + WIDTH, bottom: y + HEIGHT });
	const px = v => parseFloat(v) || 0;
	host.getBoundingClientRect = () => box(px(host.style.left), px(host.style.top));
	root.getBoundingClientRect = () =>
		box(px(host.style.left) + px(root.style.left), px(host.style.top) + px(root.style.top));
}

function openWindow(name) {
	const component = new LegacyUIComponent(name, '<div class="panel">x</div>', '');
	component.append();
	layOut(component);
	return component;
}

describe('LegacyUIComponent in the viewport', () => {
	it('a resize clamps the host and leaves the rendered root in place', () => {
		const component = openWindow('ResizePanel');
		UIManager.components[component.name] = component;
		component._host.style.left = '1000px';

		UIManager.fixResizeOverflow(800, 600);

		expect(component._host.style.left).toBe(800 - WIDTH + 'px');
		expect(component.ui[0].getBoundingClientRect().right).toBeLessThanOrEqual(800);
		delete UIManager.components[component.name];
	});

	it('opening off-screen goes back to where the window first opened', () => {
		const component = openWindow('OffscreenPanel');
		const home = { left: component._host.style.left, top: component._host.style.top };
		component.remove();
		component._host.style.left = '5000px';
		component._host.style.top = '-40px';

		component.append();

		expect(component._host.style.left).toBe(home.left);
		expect(component._host.style.top).toBe(home.top);
	});

	it('opening partly off-screen is clamped even if the window is not draggable', () => {
		const component = openWindow('EdgePanel');
		component.remove();
		component._host.style.left = window.innerWidth - 50 + 'px';
		component._host.style.top = '10px';

		component.append();

		const rect = component._host.getBoundingClientRect();
		expect(rect.left).toBeGreaterThanOrEqual(0);
		expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
	});
});
