/**
 * tests/plugins/PluginStore.test.js
 *
 * LocalPluginManager store: init-failure status flows through exec()/install()/
 * installFromSource()/bootLoad()/enable()/update()/listInstalled() instead of
 * aborting the install or counting a failed init as a success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginStore } from '../../plugins/local-plugin-manager/plugin-store.js';

// A single-request-per-transaction IndexedDB fake — the only pattern
// plugin-store.js's tx() ever uses (one dbGet/dbGetAll/dbPut/dbDelete call
// per transaction).
function createFakeIndexedDB() {
	const rows = new Map();
	return {
		open() {
			const openReq = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
			queueMicrotask(() => {
				const db = {
					objectStoreNames: { contains: () => true },
					createObjectStore() {},
					close() {},
					transaction() {
						const t = {
							oncomplete: null,
							onerror: null,
							onabort: null,
							objectStore() {
								const finish = () => queueMicrotask(() => t.oncomplete && t.oncomplete());
								return {
									get(key) {
										const req = { onsuccess: null, result: undefined };
										queueMicrotask(() => {
											req.result = rows.get(key);
											req.onsuccess && req.onsuccess();
											finish();
										});
										return req;
									},
									getAll() {
										const req = { onsuccess: null, result: undefined };
										queueMicrotask(() => {
											req.result = Array.from(rows.values());
											req.onsuccess && req.onsuccess();
											finish();
										});
										return req;
									},
									put(value) {
										const req = { onsuccess: null, result: undefined };
										queueMicrotask(() => {
											rows.set(value.name, value);
											req.result = value.name;
											req.onsuccess && req.onsuccess();
											finish();
										});
										return req;
									},
									delete(key) {
										const req = { onsuccess: null, result: undefined };
										queueMicrotask(() => {
											rows.delete(key);
											req.onsuccess && req.onsuccess();
											finish();
										});
										return req;
									}
								};
							}
						};
						return t;
					}
				};
				openReq.result = db;
				openReq.onsuccess && openReq.onsuccess();
			});
			return openReq;
		}
	};
}

// Mirrors the real native-manager host contract: register() never rejects on
// an init failure (false return or throw), only on a shape error; list()
// reports { name, status, error? }.
function createFakePluginManager() {
	const registered = Object.create(null);
	return {
		async register(def, pars, mod) {
			if (!def || typeof def.init !== 'function') {
				throw new Error('[fake-host] invalid plugin (missing init)');
			}
			try {
				const ret = await def.init(pars, {});
				registered[def.name] =
					ret === false ? { status: 'failed', error: 'init() returned false' } : { status: 'ok' };
				return ret;
			} catch (e) {
				registered[def.name] = { status: 'failed', error: e.message };
				return false;
			}
		},
		unregister(name) {
			delete registered[name];
		},
		list() {
			const out = [];
			for (const name in registered) {
				out.push({ name, ...registered[name] });
			}
			return out;
		}
	};
}

function sourceFor(name, { fail } = {}) {
	return `export default { name: ${JSON.stringify(name)}, version: '1.0.0', init() { ${
		fail ? "throw new Error('init boom')" : 'return true'
	} } }`;
}

function sourceReturningFalse(name) {
	return `export default { name: ${JSON.stringify(name)}, version: '1.0.0', init() { return false } }`;
}

const RealBlob = globalThis.Blob;

let W;
let PluginManager;
let store;

beforeEach(() => {
	vi.spyOn(URL, 'createObjectURL').mockImplementation(
		blob => 'data:text/javascript;base64,' + Buffer.from(blob.__src || '').toString('base64')
	);
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	// jsdom's Blob doesn't expose its parts back out — stash the source on the
	// Blob instance itself so the createObjectURL mock above can read it back.
	globalThis.Blob = class extends RealBlob {
		constructor(parts, opts) {
			super(parts, opts);
			this.__src = parts.join('');
		}
	};

	W = {
		indexedDB: createFakeIndexedDB(),
		fetch: vi.fn(),
		AbortController: window.AbortController,
		setTimeout: (...a) => window.setTimeout(...a),
		clearTimeout: (...a) => window.clearTimeout(...a)
	};
	PluginManager = createFakePluginManager();
	store = createPluginStore({ W, PluginManager, logger: { log() {}, warn() {}, error() {} } });
});

afterEach(() => {
	vi.restoreAllMocks();
	globalThis.Blob = RealBlob;
});

describe('installFromSource', () => {
	it('stores the record and returns ok on a successful init', async () => {
		const r = await store.installFromSource(sourceFor('Ok'), 'ok-slug');
		expect(r).toEqual({ ok: true, name: 'ok-slug', pluginName: 'Ok', version: '1.0.0' });
		const rows = await store.listInstalled();
		expect(rows.find(x => x.name === 'ok-slug').enabled).toBe(true);
	});

	it('stores the record even when init fails, returning ok:false + error', async () => {
		const r = await store.installFromSource(sourceFor('Failing', { fail: true }), 'fail-slug');
		expect(r).toEqual({ ok: false, name: 'fail-slug', pluginName: 'Failing', version: '1.0.0', error: 'init boom' });
		const rows = await store.listInstalled();
		const row = rows.find(x => x.name === 'fail-slug');
		expect(row).toBeTruthy();
		expect(row.enabled).toBe(true);
	});

	it('still throws and stores nothing for a module with no default export', async () => {
		await expect(store.installFromSource('export const notDefault = 1', 'bad-slug')).rejects.toThrow(
			'no valid default export'
		);
		const rows = await store.listInstalled();
		expect(rows.find(x => x.name === 'bad-slug')).toBeUndefined();
	});
});

describe('install', () => {
	it('fetches, stores, and surfaces an init failure the same way', async () => {
		W.fetch.mockResolvedValue({ ok: true, text: async () => sourceReturningFalse('Remote') });
		const r = await store.install('remote-slug', { origin: 'http://example.test' });
		expect(r).toEqual({
			ok: false,
			name: 'remote-slug',
			pluginName: 'Remote',
			version: '1.0.0',
			error: 'init() returned false'
		});
		const rows = await store.listInstalled();
		expect(rows.find(x => x.name === 'remote-slug').enabled).toBe(true);
	});
});

describe('bootLoad', () => {
	it('counts a failed init as failed, not loaded', async () => {
		await store.installFromSource(sourceFor('BootA'), 'boot-a');
		await store.installFromSource(sourceFor('BootB', { fail: true }), 'boot-b');

		// bootLoad re-execs from storage with a FRESH fake host, same as a real
		// reload re-registers everything from scratch.
		PluginManager = createFakePluginManager();
		store = createPluginStore({ W, PluginManager, logger: { log() {}, warn() {}, error() {} } });

		const summary = await store.bootLoad();
		expect(summary).toEqual({ loaded: 1, failed: 1 });
	});
});

describe('listInstalled', () => {
	it('carries status/error from the live registration, null when not registered', async () => {
		await store.installFromSource(sourceFor('Live'), 'live-slug');
		await store.disable('live-slug');

		const rows = await store.listInstalled();
		const live = rows.find(x => x.name === 'live-slug');
		expect(live.enabled).toBe(false);
		expect(live.status).toBeNull();
		expect(live.error).toBeNull();
	});
});
