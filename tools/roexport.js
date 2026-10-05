/**
 * roexport.js — backup / restore for origins without the native plugin manager.
 *
 * Paste into the DevTools console of the roBrowser page (or wrap it as a
 * `javascript:` bookmark), then:
 *   await ROExport.dump()                     // JSON → clipboard, also returned
 *   await ROExport.dump({ excludeWinLogin: true })
 *   await ROExport.dump({ excludePlugins: true }) // data only, no plugin code
 *   await ROExport.load(json)                 // text or object, then reload
 *
 * Self-contained page script (no import). Same format as
 * plugins/local-plugin-manager/backup.js, whose shared functions are copied
 * here verbatim (tests/plugins/backup.test.js compares them): a dump from
 * either side restores on the other.
 */
(function () {
	'use strict';

	const FORMAT = 'ro-backup';
	const FORMAT_VERSION = 1;
	const TAG = '$ro';
	// Re-downloadable caches: the item DB bundle and rocache's manifest.
	const SKIP_DBS = ['ROFW_items', 'ROFW_rocache_manifest'];
	const PLUGIN_DB = 'roframework-plugins';

	function bytesToB64(bytes) {
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(s);
	}

	function b64ToBytes(b64) {
		const s = atob(b64);
		const bytes = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) {
			bytes[i] = s.charCodeAt(i);
		}
		return bytes;
	}

	async function encodeValue(v) {
		if (v === undefined) { return { [TAG]: 'undefined' }; }
		if (typeof v === 'number') { return Number.isFinite(v) ? v : { [TAG]: 'number', value: String(v) }; }
		if (v === null || typeof v === 'string' || typeof v === 'boolean') { return v; }
		if (typeof v !== 'object') { throw new Error(`cannot back up a ${typeof v}`); }
		if (typeof File !== 'undefined' && v instanceof File) {
			return { [TAG]: 'file', name: v.name, type: v.type, lastModified: v.lastModified, data: bytesToB64(new Uint8Array(await v.arrayBuffer())) };
		}
		if (v instanceof Blob) { return { [TAG]: 'blob', type: v.type, data: bytesToB64(new Uint8Array(await v.arrayBuffer())) }; }
		if (v instanceof ArrayBuffer) { return { [TAG]: 'bytes', kind: 'ArrayBuffer', data: bytesToB64(new Uint8Array(v)) }; }
		if (ArrayBuffer.isView(v)) {
			return { [TAG]: 'bytes', kind: v.constructor.name, data: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
		}
		if (v instanceof Date) { return { [TAG]: 'date', value: String(v.getTime()) }; }
		if (Array.isArray(v)) {
			const out = new Array(v.length);
			for (let i = 0; i < v.length; i++) {
				out[i] = await encodeValue(v[i]);
			}
			return out;
		}
		const proto = Object.getPrototypeOf(v);
		if (proto !== Object.prototype && proto !== null) {
			throw new Error(`cannot back up a ${(v.constructor && v.constructor.name) || 'non-plain object'}`);
		}
		const out = {};
		for (const k in v) {
			if (k === TAG) { throw new Error(`cannot back up an object with its own '${TAG}' key`); }
			out[k] = await encodeValue(v[k]);
		}
		return out;
	}

	function decodeValue(v) {
		if (v === null || typeof v !== 'object') { return v; }
		if (Array.isArray(v)) {
			const out = new Array(v.length);
			for (let i = 0; i < v.length; i++) {
				out[i] = decodeValue(v[i]);
			}
			return out;
		}
		const tag = v[TAG];
		if (tag !== undefined) {
			switch (tag) {
				case 'undefined': return undefined;
				case 'number': return Number(v.value);
				case 'date': return new Date(Number(v.value));
				case 'blob': return new Blob([b64ToBytes(v.data)], { type: v.type });
				case 'file': return new File([b64ToBytes(v.data)], v.name, { type: v.type, lastModified: v.lastModified });
				case 'bytes': {
					const buffer = b64ToBytes(v.data).buffer;
					if (v.kind === 'ArrayBuffer') { return buffer; }
					const View = globalThis[v.kind];
					if (typeof View !== 'function' || !(View === DataView || View.BYTES_PER_ELEMENT)) {
						throw new Error(`unknown binary kind '${v.kind}'`);
					}
					return new View(buffer);
				}
				default: throw new Error(`unknown value tag '${tag}'`);
			}
		}
		const out = {};
		for (const k in v) {
			out[k] = decodeValue(v[k]);
		}
		return out;
	}

	function openDb(name, version, upgrade) {
		return new Promise((resolve, reject) => {
			const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
			if (upgrade) {
				req.onupgradeneeded = () => upgrade(req.result, req.transaction);
			}
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
			req.onblocked = () => reject(new Error(`database '${name}' is held open by another tab — close it and retry`));
		});
	}

	function requestDone(req) {
		return new Promise((resolve, reject) => {
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function dumpDatabase(name) {
		const db = await openDb(name);
		const storeNames = Array.prototype.slice.call(db.objectStoreNames);
		const stores = [];
		const pending = [];
		if (storeNames.length) {
			// Every request is issued before the first await, so the transaction stays alive.
			const t = db.transaction(storeNames, 'readonly');
			for (let i = 0; i < storeNames.length; i++) {
				const st = t.objectStore(storeNames[i]);
				const indexes = [];
				for (let j = 0; j < st.indexNames.length; j++) {
					const ix = st.index(st.indexNames[j]);
					indexes.push({ name: ix.name, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry });
				}
				stores.push({ name: st.name, keyPath: st.keyPath, autoIncrement: st.autoIncrement, indexes, records: [] });
				pending.push(requestDone(st.getAllKeys()), requestDone(st.getAll()));
			}
		}
		const results = await Promise.all(pending);
		const version = db.version;
		db.close();
		for (let i = 0; i < stores.length; i++) {
			const keys = results[2 * i];
			const values = results[2 * i + 1];
			const records = stores[i].records;
			for (let j = 0; j < keys.length; j++) {
				records.push([await encodeValue(keys[j]), await encodeValue(values[j])]);
			}
		}
		return { name, version, stores };
	}

	// Returns the `<db>/<store>` names it could not write (target schema is newer).
	async function restoreDatabase(entry) {
		let db;
		try {
			db = await openDb(entry.name, entry.version, (upgradeDb, upgradeTx) => {
				for (let i = 0; i < entry.stores.length; i++) {
					const s = entry.stores[i];
					const st = upgradeDb.objectStoreNames.contains(s.name)
						? upgradeTx.objectStore(s.name)
						: upgradeDb.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
					for (let j = 0; j < s.indexes.length; j++) {
						const ix = s.indexes[j];
						if (!st.indexNames.contains(ix.name)) {
							st.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
						}
					}
				}
			});
		} catch (e) {
			if (!e || e.name !== 'VersionError') { throw e; }
			db = await openDb(entry.name);
		}
		const skipped = [];
		const present = [];
		for (let i = 0; i < entry.stores.length; i++) {
			const s = entry.stores[i];
			if (db.objectStoreNames.contains(s.name)) { present.push(s); } else { skipped.push(entry.name + '/' + s.name); }
		}
		if (present.length) {
			await new Promise((resolve, reject) => {
				const t = db.transaction(present.map(s => s.name), 'readwrite');
				for (let i = 0; i < present.length; i++) {
					const st = t.objectStore(present[i].name);
					const records = present[i].records;
					for (let j = 0; j < records.length; j++) {
						if (st.keyPath === null) {
							st.put(decodeValue(records[j][1]), decodeValue(records[j][0]));
						} else {
							st.put(decodeValue(records[j][1]));
						}
					}
				}
				t.oncomplete = () => resolve();
				t.onerror = () => reject(t.error);
				t.onabort = () => reject(t.error || new Error(`restore of '${entry.name}' aborted`));
			});
		}
		db.close();
		return skipped;
	}

	// `skipped` (from restoreDatabase) is left out of the counts: those records were not written.
	function summarize(backup, skipped = []) {
		let records = 0;
		let plugins = 0;
		for (let i = 0; i < backup.indexedDB.length; i++) {
			const entry = backup.indexedDB[i];
			for (let j = 0; j < entry.stores.length; j++) {
				if (skipped.indexOf(entry.name + '/' + entry.stores[j].name) !== -1) { continue; }
				records += entry.stores[j].records.length;
				if (entry.name === PLUGIN_DB) { plugins += entry.stores[j].records.length; }
			}
		}
		let keys = 0;
		for (const _k in backup.localStorage) {
			keys++;
		}
		return { keys, databases: backup.indexedDB.length, records, plugins };
	}

	/** Every entry of `storage` as its raw string. */
	function dumpStorage(storage, { excludeWinLogin = false } = {}) {
		const out = {};
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (excludeWinLogin && key === 'WinLogin') { continue; }
			out[key] = storage.getItem(key);
		}
		return out;
	}

	/** Write each raw string back verbatim. Returns the number of keys written. */
	function loadStorage(storage, entries) {
		let count = 0;
		for (const key in entries) {
			storage.setItem(key, entries[key]);
			count++;
		}
		return count;
	}

	// Clipboard writes are refused once the click's user activation has expired:
	// show the JSON selected in a textarea instead (prompt() truncates big sources).
	function showForCopy(json) {
		const ta = document.createElement('textarea');
		ta.value = json;
		ta.readOnly = true;
		ta.style.cssText = 'position:fixed;inset:10%;width:80%;height:80%;z-index:2147483647;font:12px monospace';
		ta.addEventListener('keydown', e => { if (e.key === 'Escape') { ta.remove(); } });
		ta.addEventListener('blur', () => ta.remove());
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
	}

	async function dump({ excludeWinLogin = false, excludePlugins = false } = {}) {
		const list = await indexedDB.databases();
		const databases = [];
		for (let i = 0; i < list.length; i++) {
			const name = list[i].name;
			if (SKIP_DBS.indexOf(name) === -1 && !(excludePlugins && name === PLUGIN_DB)) {
				databases.push(await dumpDatabase(name));
			}
		}
		const backup = {
			format: FORMAT,
			version: FORMAT_VERSION,
			origin: location.origin,
			date: new Date().toISOString(),
			localStorage: dumpStorage(localStorage, { excludeWinLogin }),
			indexedDB: databases,
		};
		const json = JSON.stringify(backup);
		let where = 'copied to the clipboard';
		try {
			await navigator.clipboard.writeText(json);
		} catch (_e) {
			showForCopy(json);
			where = 'clipboard refused — select-all + copy from the textarea (Esc closes it)';
		}
		const n = summarize(backup);
		console.log(`[ROExport] ${n.keys} key(s), ${n.databases} database(s) / ${n.records} record(s), ${n.plugins} plugin(s) — ${where}`);
		return json;
	}

	async function load(json) {
		const backup = typeof json === 'string' ? JSON.parse(json) : json;
		if (!backup || backup.format !== FORMAT || backup.version !== FORMAT_VERSION || !Array.isArray(backup.indexedDB)) {
			throw new Error(`[ROExport] not a ${FORMAT} v${FORMAT_VERSION} backup`);
		}
		// Databases first: if one fails, localStorage is left untouched.
		const skipped = [];
		for (let i = 0; i < backup.indexedDB.length; i++) {
			const s = await restoreDatabase(backup.indexedDB[i]);
			for (let j = 0; j < s.length; j++) {
				skipped.push(s[j]);
			}
		}
		loadStorage(localStorage, backup.localStorage || {});
		const counts = summarize(backup, skipped);
		counts.skipped = skipped;
		console.log(`[ROExport] restored ${counts.keys} key(s), ${counts.databases} database(s) / ${counts.records} record(s), ${counts.plugins} plugin(s) from ${backup.origin || '?'} — reload the page now`
			+ (skipped.length ? ` (skipped, newer schema here: ${skipped.join(', ')})` : ''));
		return counts;
	}

	window.ROExport = { dump, load };
})();
