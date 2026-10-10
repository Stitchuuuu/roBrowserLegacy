/**
 * tests/plugins/LegacyUIComponent.icons.test.js
 *
 * A plugin window built on the old `(name, html, css)` contract renders inside
 * a shadow root, so the `.ro-icon` classes have to be injected there.
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

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

describe('LegacyUIComponent', () => {
	it('defines the icon classes inside its shadow root', () => {
		const component = new LegacyUIComponent(
			'IconPanel',
			'<div><span class="ro-icon ro-icon-bell"></span></div>',
			''
		);
		component.append();

		const style = component.getRoot().getElementById('ro-icon-css');
		expect(style).not.toBeNull();
		expect(style.textContent).toContain('.ro-icon-bell{');
		expect(document.getElementById('ro-icon-css')).toBeNull();
	});
});
