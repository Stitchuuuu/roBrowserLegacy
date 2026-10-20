/**
 * tests/plugins/event-bus.sticky.test.js
 *
 * The native host emits WIRE_COMPLETE at boot, before plugins loaded from
 * IndexedDB subscribe to it ; a late `once` must still be called back.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBus, EVENTS, getBus } from 'Plugins/native-manager/libs/event-bus.js';

const tick = () => Promise.resolve();

describe('native event bus — sticky events', () => {
	it('replays a sticky event to a late once, with the emit args, one time', async () => {
		const bus = createBus({ sticky: ['wire'] });
		bus.emit('wire', 42);
		const cb = vi.fn();
		bus.once('wire', cb);
		expect(cb).not.toHaveBeenCalled();
		await tick();
		expect(cb).toHaveBeenCalledExactlyOnceWith(42);
		bus.emit('wire', 43);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('does not replay to a listener removed before the microtask', async () => {
		const bus = createBus({ sticky: ['wire'] });
		bus.emit('wire');
		const cb = vi.fn();
		const off = bus.on('wire', cb);
		off();
		await tick();
		expect(cb).not.toHaveBeenCalled();
	});

	it('does not replay a non-sticky event', async () => {
		const bus = createBus({ sticky: ['wire'] });
		bus.emit('map-ready');
		const cb = vi.fn();
		bus.once('map-ready', cb);
		await tick();
		expect(cb).not.toHaveBeenCalled();
	});

	it('makes WIRE_COMPLETE sticky on the shared bus', async () => {
		getBus().emit(EVENTS.WIRE_COMPLETE, { P: 1 });
		const cb = vi.fn();
		getBus().once(EVENTS.WIRE_COMPLETE, cb);
		await tick();
		expect(cb).toHaveBeenCalledExactlyOnceWith({ P: 1 });
	});
});
