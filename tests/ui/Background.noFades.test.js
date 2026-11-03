import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	// jsdom has no 2D canvas; the background draws its progress bar on one
	HTMLCanvasElement.prototype.getContext = () => ({
		clearRect() {},
		fillRect() {},
		fillText() {},
		measureText: () => ({ width: 0 })
	});

	const frames = [];
	globalThis.requestAnimationFrame = callback => frames.push(callback);

	return { animations: [], frames, graphics: { mapTransition: 'smooth', fades: false } };
});

vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '' } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn() } }));
vi.mock('Core/Configs.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Preferences/Graphics.js', () => ({ default: mocks.graphics }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20120410 } }));
vi.mock('Utils/HtmlHelper.js', () => ({
	animateElement: vi.fn((element, props, duration, callback) => {
		mocks.animations.push({ element, props, duration, callback });
		return { stop: vi.fn() };
	})
}));

import Background from 'UI/Background.js';

function nextFrame() {
	mocks.frames.shift()(0);
}

function overlay() {
	return [...document.body.children].find(el => el.style.zIndex === '1010');
}

function image() {
	return [...document.body.children].find(el => el.tagName === 'DIV' && el.style.zIndex !== '1010');
}

describe('screen fades off', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		mocks.frames.length = 0;
	});

	it('cuts to the loading image on the next frame, smooth mode or not, and the load starts at once', () => {
		const callback = vi.fn();
		Background.setLoading(callback);

		// The caller's own work runs first, as after a fade
		expect(callback).not.toHaveBeenCalled();
		nextFrame();

		expect(callback).toHaveBeenCalledWith(undefined);
		expect(image().parentNode).toBe(document.body);
		expect(overlay()).toBeUndefined();
		expect(mocks.frames).toHaveLength(0);
		expect(mocks.animations).toHaveLength(0);
	});

	it('cuts from the loading image to the map', () => {
		const background = image();
		const callback = vi.fn();
		Background.remove(callback);

		expect(callback).toHaveBeenCalledOnce();
		expect(background.parentNode).toBeNull();
		expect(overlay()).toBeUndefined();
		expect(mocks.frames).toHaveLength(0);
		expect(mocks.animations).toHaveLength(0);
	});

	it('cuts a same-map teleport on the next frame', () => {
		const callback = vi.fn();
		Background.remove(callback);

		expect(callback).not.toHaveBeenCalled();
		nextFrame();

		expect(callback).toHaveBeenCalledOnce();
		expect(overlay()).toBeUndefined();
		expect(mocks.frames).toHaveLength(0);
		expect(mocks.animations).toHaveLength(0);
	});
});
