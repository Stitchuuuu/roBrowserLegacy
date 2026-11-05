import { describe, expect, it } from 'vitest';
import Events from 'Core/Events.js';

describe('Events.process', () => {
	it('survives a callback clearing another pending event', () => {
		Events.free();
		Events.process(0);
		let second = null;
		const ran = [];
		Events.setTimeout(() => {
			ran.push('first');
			Events.clearTimeout(second);
		}, 10);
		second = Events.setTimeout(() => ran.push('second'), 20);

		expect(() => Events.process(100)).not.toThrow();
		expect(ran).toEqual(['first']);
	});
});
