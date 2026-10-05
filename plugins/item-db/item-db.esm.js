/**
 * item-db — pre-renewal item database plugin.
 *
 * Native port of `robrowser/tools/v3/libs/item-db/src/index.js`. Keeps the
 * IndexedDB cache (`ROFW_items`, stores `items`+`meta`, version-tag
 * invalidation) and the public getters, but fetches the bundle with native
 * `fetch` from a same-origin path instead of the GM-XHR cross-origin fetch —
 * no CORS, no `window.__RO_*`.
 *
 * Cross-plugin contract : `init()` returns the API object directly, so a
 * consumer declaring `deps:['ItemDb']` reads it as `deps.ItemDb` (see
 * `native-manager.d.ts` `ItemDbApi` / `ROPluginExports`).
 *
 *   init(pars, { ItemDb }) { await ItemDb.ready; ItemDb.get(501) }
 *
 * To refresh the bundle : re-fetch the pinned commit's `bundles/cyro.json.gz`
 * from the `Stitchuuuu/ro-item-db` repo, replace `item-db-bundle.bin` next to
 * this file, and bump DB_COMMIT below (it doubles as the IndexedDB
 * cache-invalidation key, so bumping it forces every client to re-populate).
 *
 * The bundle is served as `.bin`, not `.gz` : the dev server's static
 * middleware auto-sets `Content-Encoding: gzip` for a `.gz`-suffixed file,
 * which transparently (and, here, unreliably — `res.arrayBuffer()` fails with
 * a generic "Failed to fetch" reading the body) decodes it before JS ever
 * sees it, double-decoding against our own explicit `ungzip()` below. A
 * neutral extension keeps the bytes opaque over the wire.
 */

const DB_COMMIT = '78c8a80315ab67cca0b3c700ed224a89bfc23a7c';
const DB_VERSION_TAG = DB_COMMIT;

const BUNDLE_URL = new URL('./item-db-bundle.bin', import.meta.url).pathname;

const DB_NAME = 'ROFW_items';
const DB_VERSION = 1;
const STORE_ITEMS = 'items';
const STORE_META = 'meta';

// ============================================================
// IndexedDB helpers — ported verbatim from the v3 lib.
// ============================================================

function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_ITEMS)) { db.createObjectStore(STORE_ITEMS); }
			if (!db.objectStoreNames.contains(STORE_META)) { db.createObjectStore(STORE_META); }
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function txPromise(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error('tx aborted'));
	});
}

function readMeta(db, key) {
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(key);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function clearStore(db, name) {
	const tx = db.transaction(name, 'readwrite');
	tx.objectStore(name).clear();
	return txPromise(tx);
}

/** Bulk-insert in chunks so we don't keep one huge transaction open. */
async function writeAllItems(db, itemsObj) {
	const ids = Object.keys(itemsObj);
	const CHUNK = 1000;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const tx = db.transaction(STORE_ITEMS, 'readwrite');
		const store = tx.objectStore(STORE_ITEMS);
		for (let j = i; j < Math.min(i + CHUNK, ids.length); j++) {
			const id = ids[j];
			store.put(itemsObj[id], Number(id));
		}
		await txPromise(tx);
	}
}

function writeMeta(db, key, value) {
	const tx = db.transaction(STORE_META, 'readwrite');
	tx.objectStore(STORE_META).put(value, key);
	return txPromise(tx);
}

function loadAllItems(db) {
	return new Promise((resolve, reject) => {
		/** @type {Record<string, unknown>} */
		const out = {};
		const req = db.transaction(STORE_ITEMS, 'readonly').objectStore(STORE_ITEMS).openCursor();
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				out[String(cursor.key)] = cursor.value;
				cursor.continue();
			} else {
				resolve(out);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

// ============================================================
// Network + decompression
// ============================================================

async function fetchBundle() {
	const res = await fetch(BUNDLE_URL);
	if (!res.ok) { throw new Error(`[ItemDb] ${BUNDLE_URL} → HTTP ${res.status}`); }
	return await res.arrayBuffer();
}

/** Native browser gzip (Chrome/FF/Safari since 2023). No JS dependency. */
async function ungzip(arrayBuffer) {
	const stream = new Response(arrayBuffer).body.pipeThrough(new DecompressionStream('gzip'));
	return await new Response(stream).text();
}

// ============================================================
// Boot flow
// ============================================================

async function fetchAndPopulate(db) {
	const buf = await fetchBundle();
	const text = await ungzip(buf);
	const payload = JSON.parse(text);
	const items = payload.items;
	const itemCount = Object.keys(items).length;
	await clearStore(db, STORE_ITEMS);
	await writeAllItems(db, items);
	await writeMeta(db, 'version', DB_VERSION_TAG);
	await writeMeta(db, 'fetchedAt', new Date().toISOString());
	await writeMeta(db, 'itemCount', itemCount);
	// Cached alongside the items so a cache hit restores the whole payload.
	await writeMeta(db, 'skillNames', payload.skillNames);
	await writeMeta(db, 'mobNames', payload.mobNames);
	return payload;
}

// In-memory cache populated once per page. Consumers read from this object
// (faster, simpler, <10 MB heap).
/** @type {Record<string, any> | null} */
let _items = null;
/** @type {Record<string, {id: number, desc: string}>} aegis name → skill, kept for get()'s own fields */
let _skillNames = {};
/** @type {Record<string, string>} mob id → name, kept for get()'s own fields */
let _mobNames = {};

async function _bootstrap() {
	const db = await openDb();
	const cachedVersion = await readMeta(db, 'version');
	if (cachedVersion !== DB_VERSION_TAG) {
		const payload = await fetchAndPopulate(db);
		_items = payload.items;
		_skillNames = payload.skillNames ?? {};
		_mobNames = payload.mobNames ?? {};
	} else {
		_items = await loadAllItems(db);
		_skillNames = (await readMeta(db, 'skillNames')) ?? {};
		_mobNames = (await readMeta(db, 'mobNames')) ?? {};
	}
	return _items;
}

// ============================================================
// Public API
// ============================================================

function get(id) {
	if (!_items) { return null; }
	return _items[String(id)] || _items[Number(id)] || null;
}

function search(query) {
	if (!_items) { return []; }
	const q = String(query || '').toLowerCase();
	if (!q) { return []; }
	const exact = [];
	const prefix = [];
	const substr = [];
	for (const idStr in _items) {
		const it = _items[idStr];
		const name = (it.name || '').toLowerCase();
		if (!name) { continue; }
		const rec = { id: Number(idStr), name: it.name };
		if (name === q) { exact.push(rec); }
		else if (name.startsWith(q)) { prefix.push(rec); }
		else if (name.includes(q)) { substr.push(rec); }
	}
	const byNameLen = (a, b) => a.name.length - b.name.length || a.id - b.id;
	prefix.sort(byNameLen);
	substr.sort(byNameLen);
	return [...exact, ...prefix, ...(prefix.length ? [] : substr)];
}

function all() { return _items; }
function usedBy(id) { return get(id)?.consumedBy || null; }
function producedBy(id) { return get(id)?.producedBy || null; }
function unlocks(id) { return get(id)?.unlocks || null; }
function count() { return _items ? Object.keys(_items).length : 0; }

/** @type {import('../native-manager.d.ts').NativePlugin} */
export default {
	name: 'ItemDb',
	deps: [],

	init() {
		const ready = _bootstrap().catch((e) => {
			console.error('[ItemDb] init failed:', e);
			return _items || {};
		});

		return {
			get,
			search,
			all,
			usedBy,
			producedBy,
			unlocks,
			count,
			version: DB_VERSION_TAG,
			ready,
		};
	},
};
