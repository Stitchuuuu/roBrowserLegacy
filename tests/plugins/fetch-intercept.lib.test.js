/**
 * tests/plugins/fetch-intercept.lib.test.js
 *
 * Page-side fetch-intercept lib: server gate, queueing before the worker exists, page chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MODULE = 'Plugins/native-manager/libs/fetch-intercept.js';

function fakeWorker() {
	const worker = {
		posted: [],
		listeners: [],
		postMessage: msg => worker.posted.push(msg),
		addEventListener: (type, fn) => worker.listeners.push(fn)
	};
	return worker;
}

describe('fetch-intercept lib', () => {
	let origFetch;
	let lib;

	beforeEach(async () => {
		vi.resetModules();
		origFetch = window.fetch;
		delete window.__RO_config;
		lib = await import(MODULE);
	});

	afterEach(() => {
		window.fetch = origFetch;
		delete window.__RO_config;
	});

	it('throws on register while the server gate is off', () => {
		expect(lib.fetchIntercept.enabled()).toBe(false);
		expect(() => lib.fetchIntercept.register(async () => undefined)).toThrow(
			'fetchIntercept disabled by server config'
		);
		expect(window.fetch).toBe(origFetch);
	});

	it('queues ops until the worker exists, then flushes them in order', () => {
		const ready = vi.fn();
		lib.fetchIntercept.setConfig({ a: 1 });
		lib.fetchIntercept.setConfig({ b: 2 });
		lib.fetchIntercept.onWorkerReady(ready);
		expect(window.__RO_config).toEqual({ a: 1, b: 2 });
		expect(ready).not.toHaveBeenCalled();

		const worker = fakeWorker();
		lib.attachWorker(worker);
		expect(worker.posted).toEqual([
			{ type: '__RO_setConfig', config: { a: 1 } },
			{ type: '__RO_setConfig', config: { b: 2 } }
		]);
		expect(ready).toHaveBeenCalledWith(worker);
		expect(lib.fetchIntercept.workerAvailable()).toBe(true);
		expect(lib.fetchIntercept.worker()).toBe(worker);
	});

	it('registers in the worker and on the page chain, then unregisters', async () => {
		const worker = fakeWorker();
		lib.attachWorker(worker);
		window.fetch = vi.fn(async () => new Response('net'));

		const mw = async () => new Response('page');
		const handle = lib.fetchIntercept.register(mw, { k: 1 });
		expect(worker.posted).toContainEqual({
			type: '__RO_intercept_register',
			id: handle.id,
			config: { k: 1 },
			code: mw.toString()
		});
		expect(await (await window.fetch('http://localhost/grf/x')).text()).toBe('page');

		lib.fetchIntercept.unregister(handle);
		expect(worker.posted).toContainEqual({ type: '__RO_intercept_unregister', id: handle.id });
		expect(await (await window.fetch('http://localhost/grf/x')).text()).toBe('net');
	});

	it('keeps the last worker stats report', () => {
		const worker = fakeWorker();
		lib.attachWorker(worker);
		worker.listeners.forEach(fn => fn({ data: { type: '__RO_intercept_stats', hits: 2, misses: 1, bytes: 9 } }));
		expect(lib.fetchIntercept.stats().worker).toEqual({ hits: 2, misses: 1, bytes: 9 });
	});
});

