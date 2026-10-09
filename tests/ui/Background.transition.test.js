import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	// jsdom has no 2D canvas; the background draws its progress bar on one
	HTMLCanvasElement.prototype.getContext = () => ({
		clearRect() {},
		fillRect() {},
		fillText() {},
		measureText: () => ({ width: 0 })
	});

	return { animations: [] };
});

vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '' } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn() } }));
vi.mock('Core/Configs.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20120410 } }));
vi.mock('Utils/HtmlHelper.js', () => ({
	animateElement: vi.fn((element, props, duration, callback) => {
		mocks.animations.push({ element, props, callback });
		return { stop: vi.fn() };
	})
}));

import Background from 'UI/Background.js';
import Configs from 'Core/Configs.js';
import { animateElement } from 'Utils/HtmlHelper.js';

function finishAnimation() {
	mocks.animations.shift().callback();
}

describe('Background.remove', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		document.body.innerHTML = '';
	});

	it('fades through black before the callback when no background is displayed', () => {
		const callback = vi.fn();

		Background.remove(callback);

		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 1.0 });
		expect(mocks.animations[0].element.parentNode).toBe(document.body);
		expect(callback).not.toHaveBeenCalled();

		finishAnimation();

		expect(callback).toHaveBeenCalledOnce();
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });

		const overlay = mocks.animations[0].element;
		finishAnimation();

		expect(overlay.parentNode).toBeNull();
	});

	it('cuts to black then fades in when a background is displayed', () => {
		Background.setImage('bgi_temp.bmp');
		finishAnimation();
		finishAnimation();
		const background = [...document.body.children].find(el => el.tagName === 'DIV' && el.style.zIndex !== '1000');
		expect(background).toBeDefined();

		const callback = vi.fn();
		Background.remove(callback);

		expect(callback).toHaveBeenCalledOnce();
		expect(background.parentNode).toBeNull();
		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });
		expect(mocks.animations[0].element.style.opacity).toBe('1');
	});
});

describe('Background.setLoading', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		document.body.innerHTML = '';
	});

	it('fades to black then cuts to the loading image', () => {
		const callback = vi.fn();

		Background.setLoading(callback);

		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 1.0 });
		const overlay = mocks.animations[0].element;

		finishAnimation();

		expect(callback).toHaveBeenCalledOnce();
		expect(mocks.animations).toHaveLength(0);
		expect(overlay.parentNode).toBeNull();
		expect(document.body.querySelector('canvas')).not.toBeNull();
	});
});

describe('transition duration', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		document.body.innerHTML = '';
		animateElement.mockClear();
	});

	it('defaults to 255 ms each way', () => {
		Background.remove();
		finishAnimation();

		expect(animateElement.mock.calls.map(call => call[2])).toEqual([255, 255]);
	});

	it('follows the transitionDuration config', () => {
		Configs.get.mockImplementation(key => (key === 'transitionDuration' ? 400 : undefined));

		Background.remove();

		expect(animateElement.mock.calls[0][2]).toBe(400);
		Configs.get.mockReset();
	});
});
