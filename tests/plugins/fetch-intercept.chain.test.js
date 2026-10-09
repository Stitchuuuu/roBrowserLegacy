/**
 * tests/plugins/fetch-intercept.chain.test.js
 *
 * Asset worker middleware chain and its message protocol, on a fake worker scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShim, runChain } from 'Plugins/native-manager/asset-worker-core.js';

const URL_GRF = 'http://localhost/grf/data/a.txt';

function fakeScope() {
	const scope = {
		listeners: [],
		posted: [],
		fetch: vi.fn(async () => new Response('net')),
		postMessage: msg => scope.posted.push(msg),
		addEventListener: (type, fn) => scope.listeners.push(fn)
	};
	scope.netFetch = scope.fetch;
	scope.send = data => scope.listeners.forEach(fn => fn({ data }));
	return scope;
}

describe('runChain', () => {
	it('short-circuits on a Response without fetching', async () => {
		const origFetch = vi.fn();
		const second = vi.fn();
		const res = await runChain([async () => new Response('hit'), second], new Request(URL_GRF), origFetch);
		expect(await res.text()).toBe('hit');
		expect(second).not.toHaveBeenCalled();
		expect(origFetch).not.toHaveBeenCalled();
	});

	it('falls through on undefined', async () => {
		const origFetch = vi.fn(async () => new Response('net'));
		const seen = vi.fn(async () => undefined);
		const res = await runChain([seen, seen], new Request(URL_GRF), origFetch);
		expect(await res.text()).toBe('net');
		expect(seen).toHaveBeenCalledTimes(2);
		expect(origFetch).toHaveBeenCalledOnce();
	});

	it('returns what a wrapping next() gave, with one fetch', async () => {
		const origFetch = vi.fn(async () => new Response('net'));
		const wrap = async (req, next) => {
			const res = await next();
			return new Response((await res.text()) + '+wrapped');
		};
		const res = await runChain([wrap], new Request(URL_GRF), origFetch);
		expect(await res.text()).toBe('net+wrapped');
		expect(origFetch).toHaveBeenCalledOnce();
	});

	it('runs middleware in registration order', async () => {
		const order = [];
		const list = [
			async () => {
				order.push(1);
			},
			async () => {
				order.push(2);
			}
		];
		await runChain(list, new Request(URL_GRF), async () => new Response(''));
		expect(order).toEqual([1, 2]);
	});
});

describe('installShim', () => {
	let scope;

	beforeEach(() => {
		vi.useFakeTimers();
		scope = fakeScope();
		installShim(scope);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('routes scope.fetch through registered middleware and acks', async () => {
		scope.send({ type: '__RO_intercept_register', id: 1, code: 'async () => new Response("mw")' });
		expect(scope.posted).toContainEqual({ type: '__RO_intercept_registered', id: 1, ok: true });
		expect(scope.__RO_cacheActive).toBe(true);
		const res = await scope.fetch(URL_GRF);
		expect(await res.text()).toBe('mw');
		expect(scope.netFetch).not.toHaveBeenCalled();
	});

	it('unregisters by id', async () => {
		scope.send({ type: '__RO_intercept_register', id: 1, code: 'async () => new Response("one")' });
		scope.send({ type: '__RO_intercept_register', id: 2, code: 'async () => new Response("two")' });
		scope.send({ type: '__RO_intercept_unregister', id: 1 });
		expect(await (await scope.fetch(URL_GRF)).text()).toBe('two');
		scope.send({ type: '__RO_intercept_unregister', id: 2 });
		expect(scope.__RO_cacheActive).toBe(false);
		expect(await (await scope.fetch(URL_GRF)).text()).toBe('net');
	});

	it('merges config into __RO_config before building the middleware', () => {
		scope.send({
			type: '__RO_intercept_register',
			id: 1,
			config: { bucket: 'b1' },
			code: '(() => { self.__seen = self.__RO_config.bucket + "/" + config.bucket; return async () => undefined })()'
		});
		expect(scope.__seen).toBe('b1/b1');
	});

	it('acks a middleware that fails to build with ok:false', () => {
		scope.send({ type: '__RO_intercept_register', id: 7, code: 'syntax error here' });
		const ack = scope.posted.find(msg => msg.id === 7);
		expect(ack.ok).toBe(false);
		expect(ack.error).toBeTypeOf('string');
	});

	it('merges __RO_setConfig', () => {
		scope.send({ type: '__RO_setConfig', config: { a: 1 } });
		scope.send({ type: '__RO_setConfig', config: { b: 2 } });
		expect(scope.__RO_config).toEqual({ a: 1, b: 2 });
	});

	it('posts cumulative stats every 3 s', () => {
		scope.__RO_recordHit(10);
		scope.__RO_recordMiss(5);
		vi.advanceTimersByTime(3000);
		expect(scope.posted).toContainEqual({ type: '__RO_intercept_stats', hits: 1, misses: 1, bytes: 15 });
	});
});
