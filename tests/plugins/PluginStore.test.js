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
		rows,
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

describe('nosync', () => {
	it('keeps the manifest nosync list on the record through disable and enable', async () => {
		const src = "export default { name: 'Rec', version: '1.0.0', nosync: ['rec-log'], init() { return true } }";
		await store.installFromSource(src, 'rec');
		expect(W.indexedDB.rows.get('rec').nosync).toEqual(['rec-log']);
		await store.disable('rec');
		expect(W.indexedDB.rows.get('rec').nosync).toEqual(['rec-log']);
		await store.enable('rec');
		expect(W.indexedDB.rows.get('rec').nosync).toEqual(['rec-log']);
	});

	it('stores null for a plugin that declares none', async () => {
		await store.installFromSource(sourceFor('Plain'), 'plain');
		expect(W.indexedDB.rows.get('plain').nosync).toBeNull();
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

	it('registers a stored producer before its consumer, whatever the slugs', async () => {
		// `a-consumer` sorts before `z-producer` in storage, like dropnotifier before item-db.
		await store.installFromSource(
			"export default { name: 'Consumer', version: '1.0.0', deps: ['Producer'], init() { return true } }",
			'a-consumer'
		);
		await store.installFromSource(sourceFor('Producer'), 'z-producer');

		PluginManager = createFakePluginManager();
		const order = [];
		const register = PluginManager.register;
		PluginManager.register = (def, pars, mod) => {
			order.push(def.name);
			return register(def, pars, mod);
		};
		store = createPluginStore({ W, PluginManager, logger: { log() {}, warn() {}, error() {} } });

		expect(await store.bootLoad()).toEqual({ loaded: 2, failed: 0 });
		expect(order).toEqual(['Producer', 'Consumer']);
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

// Serves a registry index plus versioned DI sources from one fetch mock.
function serve(files) {
	W.fetch.mockImplementation(async url => {
		const body = files[url];
		if (body === undefined) {
			return { ok: false, status: 404, text: async () => '' };
		}
		return { ok: true, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
	});
}

function versionedSource(name, version) {
	return `export default { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)}, init() { return true } }`;
}

const REG = 'http://registry.test/index.json';
const CDN = 'http://cdn.test/tab-target';

describe('registry index shapes', () => {
	beforeEach(() => {
		store = createPluginStore({
			W,
			PluginManager,
			logger: { log() {}, warn() {}, error() {} },
			registries: [{ label: 'Community', url: REG }]
		});
	});

	it('reads the flat serve-dist shape as a single version', async () => {
		serve({
			[REG]: {
				name: 'dev',
				plugins: [{ slug: 'tab-target', name: 'TabTarget', version: '7.21.0-a.17', url: 'http://dev.test/plugins/tab-target.di.esm.js' }]
			}
		});
		const rows = await store.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].version).toBe('7.21.0-a.17');
		expect(rows[0].versions).toEqual([
			{ version: '7.21.0-a.17', url: 'http://dev.test/plugins/tab-target.di.esm.js', installed: false, older: false }
		]);
	});

	it('reads latest + versions[], newest first, DI builds only', async () => {
		serve({
			[REG]: {
				name: 'ro-plugins',
				plugins: [
					{
						slug: 'tab-target',
						name: 'TabTarget',
						version: '7.21.0',
						latest: '7.21.0',
						url: `${CDN}/7.21.0/tab-target.di.esm.js`,
						versions: [
							{ version: '7.20.0', url: `${CDN}/7.20.0/tab-target.di.esm.js` },
							{ version: '7.21.0-a.2', url: `${CDN}/7.21.0-a.2/tab-target.di.esm.js` },
							{ version: '7.21.0-a.10', url: `${CDN}/7.21.0-a.10/tab-target.di.esm.js` },
							{ version: '7.21.0', url: `${CDN}/7.21.0/tab-target.di.esm.js` },
							{ version: '7.19.0', url: `${CDN}/7.19.0/tab-target.user.js` }
						]
					}
				]
			}
		});
		const rows = await store.list();
		expect(rows[0].version).toBe('7.21.0');
		expect(rows[0].versions.map(v => v.version)).toEqual(['7.21.0', '7.21.0-a.10', '7.21.0-a.2', '7.20.0']);
	});

	it('flags a release as an update over its own prerelease', async () => {
		serve({
			[REG]: { plugins: [{ slug: 'tab-target', version: '7.21.0', url: `${CDN}/7.21.0/tab-target.di.esm.js` }] }
		});
		await store.installFromSource(versionedSource('TabTarget', '7.21.0-a.17'), 'tab-target');
		const rows = await store.list();
		expect(rows[0].installed).toBe(true);
		expect(rows[0].updateAvailable).toBe(true);
		expect(rows[0].versions).toEqual([
			{ version: '7.21.0', url: `${CDN}/7.21.0/tab-target.di.esm.js`, installed: false, older: false }
		]);
	});
});

describe('several registries', () => {
	const DEV = 'http://localhost.test/index.json';
	const DEV_URL = 'http://localhost.test/plugins/tab-target.di.esm.js';

	beforeEach(() => {
		store = createPluginStore({
			W,
			PluginManager,
			logger: { log() {}, warn() {}, error() {} },
			registries: [
				{ label: 'V3Dev', url: DEV },
				{ label: 'Community', url: REG }
			]
		});
	});

	it('keeps the first registry build and adds the versions only a later one lists', async () => {
		serve({
			[DEV]: { plugins: [{ slug: 'tab-target', version: '7.21.0-a.17', url: DEV_URL }] },
			[REG]: {
				plugins: [
					{
						slug: 'tab-target',
						latest: '7.21.0-a.17',
						url: `${CDN}/7.21.0-a.17/tab-target.di.esm.js`,
						versions: ['7.21.0-a.17', '7.21.0-a.16'].map(v => ({ version: v, url: `${CDN}/${v}/tab-target.di.esm.js` }))
					},
					{ slug: 'radio', version: '1.0.0', url: 'http://cdn.test/radio/1.0.0/radio.di.esm.js' }
				]
			}
		});
		const rows = await store.list();
		const tab = rows.find(r => r.name === 'tab-target');
		expect(tab.registry).toBe('V3Dev');
		expect(tab.url).toBe(DEV_URL);
		expect(tab.versions.map(v => [v.version, v.url])).toEqual([
			['7.21.0-a.17', DEV_URL],
			['7.21.0-a.16', `${CDN}/7.21.0-a.16/tab-target.di.esm.js`]
		]);
		expect(rows.find(r => r.name === 'radio').registry).toBe('Community');
	});
});

describe('installed version marking', () => {
	it('marks the installed version and flags the older ones', async () => {
		store = createPluginStore({
			W,
			PluginManager,
			logger: { log() {}, warn() {}, error() {} },
			registries: [{ label: null, url: REG }]
		});
		const versions = ['1.0.0', '1.1.0', '2.0.0'].map(v => ({ version: v, url: `${CDN}/${v}/tab-target.di.esm.js` }));
		serve({ [REG]: { plugins: [{ slug: 'tab-target', latest: '2.0.0', url: versions[2].url, versions }] } });
		await store.installFromSource(versionedSource('TabTarget', '1.1.0'), 'tab-target');
		const rows = await store.list();
		expect(rows[0].versions.map(v => [v.version, v.installed, v.older])).toEqual([
			['2.0.0', false, false],
			['1.1.0', true, false],
			['1.0.0', false, true]
		]);
	});
});

describe('update to another published version', () => {
	const v1 = `${CDN}/1.0.0/tab-target.di.esm.js`;
	const v2 = `${CDN}/2.0.0/tab-target.di.esm.js`;

	beforeEach(() => {
		serve({ [v1]: versionedSource('TabTarget', '1.0.0'), [v2]: versionedSource('TabTarget', '2.0.0') });
		window.localStorage.setItem('TabTargetNative.lockKey', '{"code":"KeyQ"}');
	});

	afterEach(() => {
		window.localStorage.removeItem('TabTargetNative.lockKey');
	});

	it('downgrades the live code and keeps settings and flags', async () => {
		await store.install('tab-target', { sourceUrl: v2, debug: true });
		const r = await store.update('tab-target', { sourceUrl: v1 });
		expect(r).toMatchObject({ ok: true, version: '1.0.0', oldVersion: '2.0.0' });

		const row = (await store.listInstalled()).find(x => x.name === 'tab-target');
		expect(row).toMatchObject({ version: '1.0.0', enabled: true, debug: true, status: 'ok' });
		expect(window.localStorage.getItem('TabTargetNative.lockKey')).toBe('{"code":"KeyQ"}');

		// The old version is what boots next time.
		PluginManager = createFakePluginManager();
		store = createPluginStore({ W, PluginManager, logger: { log() {}, warn() {}, error() {} } });
		await store.bootLoad();
		const plain = await store.update('tab-target');
		expect(plain.version).toBe('1.0.0');
	});

	it('labels a disabled plugin with the version it now holds', async () => {
		await store.install('tab-target', { sourceUrl: v2 });
		await store.disable('tab-target');
		await store.update('tab-target', { sourceUrl: v1, version: '1.0.0' });
		const row = (await store.listInstalled()).find(x => x.name === 'tab-target');
		expect(row).toMatchObject({ version: '1.0.0', enabled: false });
		await store.enable('tab-target');
		expect(PluginManager.list()).toEqual([{ name: 'TabTarget', status: 'ok' }]);
		expect((await store.listInstalled())[0].version).toBe('1.0.0');
	});
});
