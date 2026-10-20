/**
 * tests/engine/AutoRetry.test.js
 *
 * Retry policy: which failures replay, and how soon.
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

	it('retries right away once the last connection is 3.5 s old', () => {
		AutoRetry.arm('user', 'pass');
		AutoRetry.onRetry = vi.fn();
		vi.advanceTimersByTime(5000);

		AutoRetry.schedule(null);
		vi.advanceTimersByTime(0);
		expect(AutoRetry.onRetry).toHaveBeenCalledOnce();
	});

	it('waits only the rest of the 3.5 s gap after a quick failure', () => {
		AutoRetry.arm('user', 'pass');
		AutoRetry.onRetry = vi.fn();
		vi.advanceTimersByTime(200);

		AutoRetry.schedule(null);
		vi.advanceTimersByTime(3299);
		expect(AutoRetry.onRetry).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(AutoRetry.onRetry).toHaveBeenCalledOnce();
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
