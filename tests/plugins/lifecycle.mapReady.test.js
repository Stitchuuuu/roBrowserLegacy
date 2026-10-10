/**
 * tests/plugins/lifecycle.mapReady.test.js
 *
 * map-ready on a change of map: it waits for the load, however long it takes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	entered: [],
	background: null,
	UIComponent: class {
		append() {}
	}
}));

vi.mock('Plugins/native-manager/libs/plugin-api.js', () => ({
	PACKET: { ZC: { NPCACK_MAPMOVE: function NPCACK_MAPMOVE() {} }, HC: {} },
	Session: {},
	get Background() {
		return mocks.background;
	},
	get UIComponent() {
		return mocks.UIComponent;
	}
}));
vi.mock('Plugins/native-manager/libs/packet-observer.js', () => ({
	observePacket: (cls, cb) => {
		if (cls.name === 'NPCACK_MAPMOVE') mocks.entered.push(cb);
	}
}));
vi.mock('Plugins/native-manager/libs/socket-observer.js', () => ({
	observeSocket: () => {},
	observeSocketStatus: () => ({ openSocketCount: 1 })
}));

async function load(background) {
	vi.resetModules();
	vi.useFakeTimers();
	mocks.entered.length = 0;
	mocks.background = background;
	mocks.UIComponent = class {
		append() {}
	};
	const lifecycle = await import('Plugins/native-manager/libs/lifecycle.js');
	const { on, EVENTS } = await import('Plugins/native-manager/libs/event-bus.js');
	lifecycle.setLogger({ log() {}, warn() {}, verbose() {} });
	// Past the debounce of the first entry
	vi.advanceTimersByTime(1000);
	const ready = vi.fn();
	on(EVENTS.MAP_READY, ready);
	return { ready, enterMap: () => mocks.entered.forEach(cb => cb()) };
}

describe('lifecycle map-ready', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('waits for the end of a long load when the Background trap is in place', async () => {
		const background = { remove: vi.fn(callback => callback()) };
		const { ready, enterMap } = await load(background);

		enterMap();
		vi.advanceTimersByTime(5000);
		expect(ready).not.toHaveBeenCalled();

		background.remove(() => {});
		expect(ready).toHaveBeenCalledOnce();
	});

	it('does not come with the first window appended while the map loads', async () => {
		const background = { remove: vi.fn(callback => callback()) };
		const { ready, enterMap } = await load(background);

		enterMap();
		new mocks.UIComponent().append();
		vi.advanceTimersByTime(1000);
		expect(ready).not.toHaveBeenCalled();
	});

	it('still comes after a while when the Background trap could not be set', async () => {
		const { ready, enterMap } = await load(null);

		enterMap();
		vi.advanceTimersByTime(2600);
		expect(ready).toHaveBeenCalledOnce();
	});
});
