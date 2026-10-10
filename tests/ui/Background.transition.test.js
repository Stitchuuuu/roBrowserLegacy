import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	// jsdom has no 2D canvas; the background draws its progress bar on one
	HTMLCanvasElement.prototype.getContext = () => ({
		clearRect() {},
		fillRect() {},
		fillText() {},
		measureText: () => ({ width: 0 })
	});

	// The fade from black waits on display frames: queue them, the test runs them
	const frames = [];
	globalThis.requestAnimationFrame = callback => frames.push(callback);

	return { animations: [], frames };
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
 * Run display frames on time until no fade from black is left waiting
 */
function settle() {
	for (let time = 0; mocks.frames.length && time < 1000; time += 8) {
		frames(time);
	}
}

describe('Background.remove', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		mocks.frames.length = 0;
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
		settle();

		expect(callback).toHaveBeenCalledOnce();
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });

		const overlay = mocks.animations[0].element;
		finishAnimation();

		expect(overlay.parentNode).toBeNull();
	});

	it('cuts to black then fades in when a background is displayed', () => {
		Background.setImage('bgi_temp.bmp');
		finishAnimation();
		settle();
		finishAnimation();
		const background = [...document.body.children].find(el => el.tagName === 'DIV' && el.style.zIndex !== '1000');
		expect(background).toBeDefined();

		const callback = vi.fn();
		Background.remove(callback);
		settle();

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
		mocks.frames.length = 0;
		document.body.innerHTML = '';
		animateElement.mockClear();
	});

	it('defaults to 255 ms each way', () => {
		Background.remove();
		finishAnimation();
		settle();

		expect(animateElement.mock.calls.map(call => call[2])).toEqual([255, 255]);
	});

	it('follows the transitionDuration config', () => {
		Configs.get.mockImplementation(key => (key === 'transitionDuration' ? 400 : undefined));

		Background.remove();

		expect(animateElement.mock.calls[0][2]).toBe(400);
		Configs.get.mockReset();
	});
});

/**
 * The work done at black (the map UI restarting, the first frames of a new map)
 * landed in the fade from black and showed as a stutter.
 */
describe('the fade from black', () => {
	beforeEach(() => {
		mocks.animations.length = 0;
		mocks.frames.length = 0;
		document.body.innerHTML = '';
	});

	it('waits for the display frames to come back on time', () => {
		Background.remove();
		finishAnimation();

		frames(0, 120, 128, 136);
		expect(mocks.animations).toHaveLength(0);

		frames(144);
		expect(mocks.animations).toHaveLength(1);
		expect(mocks.animations[0].props).toEqual({ opacity: 0.01 });
	});

	it('starts anyway after a second of long frames', () => {
		Background.remove();
		finishAnimation();

		frames(0, 300, 600, 900);
		expect(mocks.animations).toHaveLength(0);

		frames(1200);
		expect(mocks.animations).toHaveLength(1);
	});

	it('is dropped by the next transition', () => {
		Background.remove();
		finishAnimation();
		frames(0);

		Background.setLoading(vi.fn());
		const pending = mocks.animations.length;
		frames(8, 16, 24, 32);

		expect(mocks.animations).toHaveLength(pending);
	});
});
