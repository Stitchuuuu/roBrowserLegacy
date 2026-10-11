/**
 * tests/ui/UIButton.skin.test.js
 *
 * The 3-slice text skin of <ui-button>.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '' } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: (path, callback) => callback(path) } }));

await import('UI/Elements/UIButton.js');

/**
 * @param {string} state out, over, press or disable
 * @returns {string} the background layers of that state
 */
function skinOf(state) {
	return ['left', 'right', 'mid'].map(part => `url("basic_interface/btn_${state}_${part}.bmp")`).join(', ');
}

/**
 * @param {string} html
 * @returns {HTMLElement} the connected button
 */
function mount(html) {
	document.body.innerHTML = html;
	return document.body.firstElementChild;
}

describe('ui-button skin', () => {
	it('draws the left, right and mid slices of each state', () => {
		const button = mount('<ui-button skin="basic_interface/btn">Sell all</ui-button>');

		expect(button.style.backgroundImage).toBe(skinOf('out'));

		button.dispatchEvent(new MouseEvent('mouseover'));
		expect(button.style.backgroundImage).toBe(skinOf('over'));

		button.dispatchEvent(new MouseEvent('mousedown'));
		expect(button.style.backgroundImage).toBe(skinOf('press'));

		button.dispatchEvent(new MouseEvent('mouseout'));
		expect(button.style.backgroundImage).toBe(skinOf('out'));
		expect(button.textContent).toBe('Sell all');
	});

	it('uses the disable slices instead of fading the button', () => {
		const button = mount('<ui-button skin="basic_interface/btn">Sell all</ui-button>');

		button.disabled = true;

		expect(button.style.backgroundImage).toBe(skinOf('disable'));
		expect(button.style.opacity).toBe('');
	});

	it('keeps the single image of a button without skin', () => {
		const button = mount('<ui-button bg="btn_ok.bmp" hover="btn_ok_a.bmp"></ui-button>');

		expect(button.style.backgroundImage).toBe('url("btn_ok.bmp")');

		button.dispatchEvent(new MouseEvent('mouseover'));
		expect(button.style.backgroundImage).toBe('url("btn_ok_a.bmp")');

		button.disabled = true;
		expect(button.style.opacity).toBe('0.5');
	});
});
