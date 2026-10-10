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

	return { animations: [], frames, graphics: { mapTransition: '' } };
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
import Configs from 'Core/Configs.js';

function finishAnimation() {
	mocks.animations.shift().callback();
}

/**
 * Run the next display frames at these timestamps
 *
 * @param {...number} times in ms
 */
function frames(...times) {
	for (const time of times) {
		mocks.frames.shift()?.(time);
	}
}

/**
 * Run display frames on time until nothing waits on them
 */
function settle() {
	for (let time = 0; mocks.frames.length && time < 1000; time += 8) {
		frames(time);
	}
}

/**
 * The loading screen of a map change, fully shown
 *
 * @return {function} the load start passed to the callback
 */
function loadingShown() {
	const start = vi.fn();
	Background.setLoading(whenShown => whenShown(start));
	finishAnimation();
	frames(0);
	settle();
	finishAnimation();
	return start;
}

function image() {
	return [...document.body.children].find(el => el.tagName === 'DIV' && el.style.zIndex !== '1000');
}

describe('smooth map transition', () => {
	beforeEach(() => {
		Configs.get.mockReset();
		mocks.graphics.mapTransition = 'smooth';
		mocks.animations.length = 0;
		mocks.frames.length = 0;
		document.body.innerHTML = '';
	});

	it('fades to black, then the loading image comes out of black before the load starts', () => {
		const start = vi.fn();
		const callback = vi.fn(whenShown => whenShown(start));
		Background.setLoading(callback);

		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 1.0 });
		expect(mocks.animations[0].duration).toBe(125);
		finishAnimation();

		// At black: the work there runs, the load does not
		frames(0);
		expect(callback).toHaveBeenCalledOnce();
		expect(image().parentNode).toBe(document.body);
		expect(start).not.toHaveBeenCalled();

		// The image comes out of black once 3 frames are on time
		frames(0, 140, 148, 156);
		expect(mocks.animations).toHaveLength(0);
		frames(164);
		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });
		expect(mocks.animations[0].duration).toBe(125);
		expect(start).not.toHaveBeenCalled();

		finishAnimation();
		expect(start).toHaveBeenCalledOnce();
	});

	it('fades the loading image to black, then black to the new map', () => {
		loadingShown();
		const background = image();

		const callback = vi.fn();
		Background.remove(callback);

		// The image stays still until the frames are on time again after the load
		expect(mocks.animations).toHaveLength(0);
		frames(0, 100, 108, 116);
		expect(mocks.animations).toHaveLength(0);
		frames(124);

		// No cut: the image fades to black first
		expect(callback).not.toHaveBeenCalled();
		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 1.0 });
		expect(mocks.animations[0].duration).toBe(125);
		expect(mocks.animations[0].element.style.opacity).toBe('0.01');
		finishAnimation();

		frames(0);
		expect(callback).toHaveBeenCalledOnce();
		expect(background.parentNode).toBeNull();

		// The client's calm stretch before the fade from black
		settle();
		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });
		expect(mocks.animations[0].duration).toBe(125);
	});

	it('fades 125 ms each time, whatever the client mode fades last', () => {
		Configs.get.mockImplementation(key => (key === 'transitionDuration' ? 400 : undefined));
		const durations = [];
		const start = vi.fn();

		Background.setLoading(whenShown => whenShown(start));
		durations.push(mocks.animations[0].duration);
		finishAnimation();
		frames(0);
		settle();
		durations.push(mocks.animations[0].duration);
		finishAnimation();
		Background.remove();
		settle();
		durations.push(mocks.animations[0].duration);
		finishAnimation();
		frames(0);
		settle();
		durations.push(mocks.animations[0].duration);

		expect(durations).toEqual([125, 125, 125, 125]);
	});

	it('follows the ROConfig default when the player has not chosen', () => {
		mocks.graphics.mapTransition = '';
		Configs.get.mockImplementation(key => (key === 'mapTransition' ? 'smooth' : undefined));
		const callback = vi.fn();

		Background.setLoading(callback);
		finishAnimation();
		frames(0);

		expect(callback.mock.calls[0][0]).toBeTypeOf('function');
	});

	it('lets the player choice override the ROConfig default', () => {
		mocks.graphics.mapTransition = 'client';
		Configs.get.mockImplementation(key => (key === 'mapTransition' ? 'smooth' : undefined));
		const callback = vi.fn();

		Background.setLoading(callback);
		finishAnimation();
		frames(0);

		// Client mode: a cut to the loading image, the load starts at once
		expect(callback).toHaveBeenCalledWith(undefined);
		settle();
		expect(mocks.animations).toHaveLength(0);
	});

	it('keeps the black fade of the client on a same-map teleport', () => {
		Background.remove();

		expect(mocks.animations[0].duration).toBe(255);
		finishAnimation();
		frames(0);
		settle();
		expect(mocks.animations[0].duration).toBe(255);
	});

	it('replaces the image without a fade on the first entry from the character screen', () => {
		mocks.graphics.mapTransition = 'client';
		Background.setImage('bgi_temp.bmp');
		finishAnimation();
		settle();
		finishAnimation();
		mocks.graphics.mapTransition = 'smooth';

		const callback = vi.fn();
		Background.setLoading(callback);

		expect(mocks.animations).toHaveLength(0);
	});
});
