import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ graphics: { mapTransition: '' } }));

vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: 'data/texture/' } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn((path, onload) => onload('blob:' + path)) } }));
vi.mock('Core/Configs.js', () => ({ default: { get: () => undefined } }));
vi.mock('Preferences/Graphics.js', () => ({ default: mocks.graphics }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20221005 } }));

// Frames by hand: the overlay's opacity is checked at chosen times. The
// fades last 255 ms each, and a fade from black waits for 150 ms of frames
// under 25 ms, a second at most (docs/reference/map-transition.md).
let now = 0;
const frames = [];
vi.spyOn(performance, 'now').mockImplementation(() => now);
vi.stubGlobal('requestAnimationFrame', fn => frames.push(fn));
const ctx = new Proxy({}, { get: () => () => ({ width: 0 }) });
const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);

function advance(ms) {
	now += ms;
	frames.splice(0).forEach(fn => fn(now));
}

// Frames on time until a fade from black may start
function calm() {
	for (let i = 0; i < 12; i++) advance(16);
}

const { default: Background } = await import('UI/Background.js');
const overlay = () => [...document.body.children].find(el => el.style.zIndex === '1010');

beforeEach(() => {
	mocks.graphics.mapTransition = '';
});

afterAll(() => {
	getContext.mockRestore();
	vi.unstubAllGlobals();
});

describe('Background transitions', () => {
	it('fades back in from black when the map loads before the fade to its loading image is over', () => {
		const revealed = vi.fn();

		// The map was already loaded: it is set up in setLoading's callback
		Background.setLoading(() => Background.remove(revealed));

		advance(125);
		expect(Number(overlay().style.opacity)).toBeCloseTo(0.495, 2);
		advance(130);
		advance(16);
		expect(revealed).toHaveBeenCalledOnce();

		// One fade back from black, not two fighting over the overlay
		calm();
		advance(125);
		expect(Number(overlay().style.opacity)).toBeGreaterThan(0.4);
		expect(Number(overlay().style.opacity)).toBeLessThan(0.6);
		advance(140);
		expect(overlay()).toBeUndefined();
	});

	it('fades to black at the usual pace from where the overlay is, when a transition starts during a fade from black', () => {
		Background.remove();
		advance(255);
		advance(16);
		calm();
		advance(100);
		const from = Number(overlay().style.opacity);
		expect(from).toBeGreaterThan(0.3);
		expect(from).toBeLessThan(0.9);

		const revealed = vi.fn();
		Background.remove(revealed);
		advance(125);
		expect(revealed).not.toHaveBeenCalled();
		expect(Number(overlay().style.opacity)).toBeGreaterThan(from);
		expect(Number(overlay().style.opacity)).toBeLessThan(1);
		advance(130);
		advance(16);
		expect(revealed).toHaveBeenCalledOnce();
		calm();
		advance(260);
		expect(overlay()).toBeUndefined();
	});
});

describe('Background depth while it is removed', () => {
	const container = () => [...document.body.children].find(el => el.tagName === 'DIV' && el !== overlay());
	const canvas = () => [...document.body.children].find(el => el.tagName === 'CANVAS');
	const settle = () => {
		for (let i = 0; i < 8; i++) advance(500);
	};

	// The client mode cuts from the loading image to black: the image is gone
	// at once. Smooth mode fades it, which is when its depth matters.
	it('keeps the image over the touch controls and under the black overlay until the screen is black', () => {
		mocks.graphics.mapTransition = 'smooth';
		Background.setLoading();
		settle();

		Background.remove();
		advance(250);
		// The touch controls' host sits at 1000
		expect(Number(container().style.zIndex)).toBeGreaterThan(1000);
		expect(Number(canvas().style.zIndex)).toBeGreaterThan(1000);
		expect(Number(overlay().style.zIndex)).toBeGreaterThan(Number(canvas().style.zIndex));

		settle();
		expect(container()).toBeUndefined();
		expect(canvas()).toBeUndefined();
	});

	it('puts a background that replaces it during the fade to black back at its own depth', () => {
		mocks.graphics.mapTransition = 'smooth';
		Background.setLoginBackground();
		settle();
		const depth = [container().style.zIndex, canvas().style.zIndex];

		Background.remove();
		advance(250);
		Background.setLoginBackground();
		expect(Number(container().style.zIndex)).toBeGreaterThan(1000);

		// Still raised until the screen is black, then back where it was
		settle();
		expect([container().style.zIndex, canvas().style.zIndex]).toEqual(depth);
		expect(Number(container().style.zIndex)).toBeLessThan(50);
	});

	it('sets a background asked for during the fade back from black at the bottom', () => {
		Background.remove();
		advance(255);
		advance(16);
		expect(container()).toBeUndefined();

		advance(100);
		Background.setLoginBackground();
		settle();
		expect(Number(container().style.zIndex)).toBeLessThan(50);
		expect(Number(canvas().style.zIndex)).toBeLessThan(50);
	});
});
