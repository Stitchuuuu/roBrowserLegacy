/**
 * tests/engine/AutoRetry.test.js
 *
 * Retry policy: which failures replay, and how long each one waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AutoRetry from 'Engine/AutoRetry.js';

describe('AutoRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		AutoRetry.disarm();
	});

	afterEach(() => {
		AutoRetry.disarm();
		vi.useRealTimers();
	});

	it('waits longer after each failed attempt, up to 30 s', () => {
		const delays = [];

		for (let i = 0; i < 6; i++) {
			AutoRetry.arm('user', 'pass');
			const retry = vi.fn();
			AutoRetry.onRetry = retry;
			AutoRetry.schedule(null);

			const before = Date.now();
			while (!retry.mock.calls.length && Date.now() - before < 60000) {
				vi.advanceTimersByTime(1000);
			}
			delays.push(Date.now() - before);
		}

		expect(delays).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
	});

	it('runs the callback it is given, or replays the login', () => {
		AutoRetry.onRetry = vi.fn();
		AutoRetry.arm('user', 'pass');

		const retry = vi.fn();
		AutoRetry.schedule(null, retry);
		vi.runAllTimers();
		expect(retry).toHaveBeenCalledOnce();
		expect(AutoRetry.onRetry).not.toHaveBeenCalled();

		AutoRetry.schedule(null);
		vi.runAllTimers();
		expect(AutoRetry.onRetry).toHaveBeenCalledWith('user', 'pass');
	});

	it('does not retry a login someone else took over', () => {
		AutoRetry.arm('user', 'pass');

		expect(AutoRetry.canRetry('ban', 2)).toBe(false);
		expect(AutoRetry.canRetry('ban', 8)).toBe(true);
	});

	it('has no login to replay when armed from char select', () => {
		AutoRetry.arm();

		expect(AutoRetry.armed()).toBe(true);
		expect(AutoRetry.canRetry('network')).toBe(false);
	});
});
