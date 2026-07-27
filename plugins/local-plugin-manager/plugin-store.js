// plugin-store.js — LocalPluginManager (LPM) IndexedDB store.
//
// Ported near-verbatim from the v3 framework
// (`robrowser/tools/v3/framework/core/src/plugin-store.js`). Persists plugins in
// IndexedDB so they reload at boot WITHOUT the network — the bare ESM module is
// fetched once at install, its source stashed, and re-executed from IndexedDB on
// every subsequent boot.
//
// Execution model (identical at install and at boot):
//   source string → Blob → import(blobUrl) → PluginManager.register(mod.default)
// Here `PluginManager` is the native manager's runtime host (`PluginHost`),
// injected into LocalPluginManager's DI map. Stored plugins are pure-DI native
// ESM (`export default { name, init }`) — they receive the engine modules via
// `init(pars, diMap)` and carry NO static `@robrowser/*` imports (the native
// path has no import-map; DI covers everything).
//
// Changes vs the ported source: (1) `fetchText` drops the `__RO_GM.xmlhttpRequest`
// CORS-bypass fallback (page-context `fetch` only); (2) `exec` awaits the host
// register and passes the module namespace for dep-fallback exports.
//
// Identity note : the store keys everything by SLUG (the install identifier / URL
// component). That is distinct from the manifest plugin name under which the
// host registers the plugin (read from `mod.default.name`). The IndexedDB
// record's `name` field holds the slug ; `pluginName`/`version` hold the
// manifest data. DB name / store / keyPath / version are kept byte-identical to
// the source they were ported from, so an export bookmarklet can round-trip the
// records verbatim.

const DB_NAME = 'roframework-plugins'
const STORE = 'plugins'
const DEFAULT_ORIGIN = 'http://localhost:6980'
// Discovery (GET /index.json) must fail fast when the serve is down — the Plugin
// Manager renders installed plugins first, then merges this. A long wait here
// would only delay the "serve down?" hint, never the installed list.
const DISCOVERY_TIMEOUT_MS = 4000

/**
 * Open (and lazily create) the IndexedDB database. Object store `plugins`,
 * keyPath `name` (= slug). Returns a Promise<IDBDatabase>.
 */
function openDb(W) {
	return new Promise((resolve, reject) => {
		const idb = W.indexedDB
		if (!idb) { reject(new Error('[plugin-store] IndexedDB unavailable in this context')); return }
		const req = idb.open(DB_NAME, 1)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'name' })
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error || new Error('[plugin-store] IndexedDB open failed'))
	})
}

/** Promisify a single-store transaction. `mode` is 'readonly' | 'readwrite'. */
async function tx(W, mode, fn) {
	const db = await openDb(W)
	return new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode)
		const store = t.objectStore(STORE)
		let result
		Promise.resolve(fn(store)).then(r => { result = r }).catch(reject)
		t.oncomplete = () => { db.close(); resolve(result) }
		t.onerror = () => { db.close(); reject(t.error || new Error('[plugin-store] transaction failed')) }
		t.onabort = () => { db.close(); reject(t.error || new Error('[plugin-store] transaction aborted')) }
	})
}

/** Wrap an IDBRequest in a Promise. */
function reqPromise(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

async function dbGet(W, name)     { return tx(W, 'readonly',  s => reqPromise(s.get(name))) }
async function dbGetAll(W)        { return tx(W, 'readonly',  s => reqPromise(s.getAll())) }
async function dbPut(W, record)   { return tx(W, 'readwrite', s => reqPromise(s.put(record))) }
async function dbDelete(W, name)  { return tx(W, 'readwrite', s => reqPromise(s.delete(name))) }

/**
 * Build the LPM store bound to a window `W` and a `PluginManager` (the native
 * runtime host `{ register, unregister, list }`). Called once from the
 * LocalPluginManager plugin's init().
 */
export function createPluginStore({ W, PluginManager, logger }) {
	const log = (logger && logger.log)  || ((...a) => console.log(...a))
	const warn = (logger && logger.warn) || ((...a) => console.warn(...a))
	const err  = (logger && logger.error) || ((...a) => console.error(...a))

	/**
	 * Fetch a text resource via page-context `fetch()`. `timeoutMs` bounds it
	 * with an `AbortController` — without it, a down serve (mixed-content stall)
	 * would hang forever. Discovery uses a short timeout (fail-fast) ;
	 * install/update keep the long 15 s download window. A CORS / network / HTTP
	 * failure throws (surfaced to the ChatBox by the caller) — there is no
	 * GM-XHR CORS-bypass fallback.
	 */
	async function fetchText(url, timeoutMs = 15000) {
		const ctl = typeof W.AbortController === 'function' ? new W.AbortController() : null
		const timer = ctl ? W.setTimeout(() => ctl.abort(), timeoutMs) : null
		try {
			const res = await W.fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
			if (!res.ok) throw new Error(`[plugin-store] HTTP ${res.status} on ${url}`)
			return await res.text()
		} finally {
			if (timer) W.clearTimeout(timer)
		}
	}

	/**
	 * Execute a plugin ESM source string : Blob → import(blobUrl) → register.
	 * Returns `mod.default` (the manifest object) so callers can read its
	 * `name`/`version`. The blob URL is revoked once `import()` resolves. The
	 * host `register` is awaited (it awaits the plugin's init) and given the
	 * module namespace so a stored producer's namespace can be a dep fallback.
	 */
	async function exec(source) {
		const blob = new Blob([source], { type: 'application/javascript' })
		const blobUrl = URL.createObjectURL(blob)
		try {
			const mod = await import(blobUrl)
			if (!mod || !mod.default || typeof mod.default.name !== 'string') {
				throw new Error('[plugin-store] module has no valid default export ({ name, init, ... })')
			}
			await PluginManager.register(mod.default, null, mod)
			return mod.default
		} finally {
			URL.revokeObjectURL(blobUrl)
		}
	}

	/**
	 * Discovery — GET /index.json from the serve. Returns the `plugins` array
	 * or `[]` on failure. In the native context there is no dist serve, so this
	 * simply yields `[]` (install goes by explicit URL / dropped source instead).
	 */
	async function available(origin = DEFAULT_ORIGIN) {
		try {
			const json = await fetchText(`${origin}/index.json`, DISCOVERY_TIMEOUT_MS)
			const data = JSON.parse(json)
			return Array.isArray(data.plugins) ? data.plugins : []
		} catch (e) {
			warn('[plugin-store] available() failed:', e.message)
			return []
		}
	}

	/**
	 * Install a plugin by slug : fetch its bare ESM module, exec + register it
	 * live, and persist the source in IndexedDB (enabled) so it reloads at boot
	 * without the network.
	 *
	 * @param {string} name  plugin slug — IDB key + URL component.
	 * @param {object} [opts] { sourceUrl?, debug?, origin? }
	 */
	async function install(name, opts = {}) {
		const origin = opts.origin || DEFAULT_ORIGIN
		const debug = !!opts.debug
		const variant = debug ? '.debug.esm.js' : '.esm.js'
		const sourceUrl = opts.sourceUrl || `${origin}/plugins/${name}${variant}`

		log(`[plugin-store] install '${name}' from ${sourceUrl}`)
		const source = await fetchText(sourceUrl)
		const manifest = await exec(source)

		const record = {
			name,                          // slug — IDB key
			source,                        // bare ESM module text
			version: manifest.version || null,
			pluginName: manifest.name,     // manifest registration name
			enabled: true,
			sourceUrl,
			debug,
			installedAt: Date.now(),
		}
		await dbPut(W, record)
		log(`[plugin-store ✓] installed '${name}' (${manifest.name} v${manifest.version || '?'}) — persisted to IndexedDB`)
		return { ok: true, name, pluginName: manifest.name, version: manifest.version }
	}

	/**
	 * Install from a raw source string (e.g. a dropped `.esm.js` read via
	 * `file.text()`). No network — exec + persist directly. The caller supplies
	 * the slug (IDB key), typically derived from the dropped filename. The source
	 * MUST be a bare ESM module with a `default` export ; exec() rejects anything
	 * else (a Tampermonkey `.user.js` wrapper has no default export).
	 *
	 * @param {string} source  raw bare-ESM module text.
	 * @param {string} name    plugin slug — IDB key.
	 * @param {object} [opts]   { debug? }
	 */
	async function installFromSource(source, name, opts = {}) {
		if (!source || typeof source !== 'string') throw new Error('[plugin-store] installFromSource: empty source')
		if (!name) throw new Error('[plugin-store] installFromSource: missing slug')

		log(`[plugin-store] installFromSource '${name}' (${source.length} bytes)`)
		const manifest = await exec(source)   // throws on non-ESM / no default export

		const record = {
			name,                          // slug — IDB key
			source,                        // bare ESM module text
			version: manifest.version || null,
			pluginName: manifest.name,     // manifest registration name
			enabled: true,
			sourceUrl: null,               // no network origin — update() warns 'no sourceUrl'
			debug: !!opts.debug,
			installedAt: Date.now(),
		}
		await dbPut(W, record)
		log(`[plugin-store ✓] installed '${name}' (${manifest.name} v${manifest.version || '?'}) from dropped source — persisted to IndexedDB`)
		return { ok: true, name, pluginName: manifest.name, version: manifest.version }
	}

	/**
	 * Installed plugins only — IndexedDB read, NO network. Same entry shape as
	 * list() (with `available:false`).
	 */
	async function listInstalled() {
		const installed = await dbGetAll(W).catch(() => [])
		return installed.map(rec => ({
			name: rec.name,
			pluginName: rec.pluginName || null,
			version: rec.version || null,
			installed: true,
			enabled: !!rec.enabled,
			debug: !!rec.debug,
			available: false,
		}))
	}

	/**
	 * Merge IndexedDB (installed) with serve discovery (available). Each entry :
	 * `{ name, version, installed, enabled, available, debug }`.
	 */
	async function list(origin = DEFAULT_ORIGIN) {
		const [installed, avail] = await Promise.all([
			listInstalled(),
			available(origin),
		])
		const byName = new Map()
		for (const entry of installed) {
			byName.set(entry.name, entry)
		}
		for (const a of avail) {
			const existing = byName.get(a.slug)
			if (existing) { existing.available = true; if (!existing.version) existing.version = a.version }
			else byName.set(a.slug, {
				name: a.slug,
				pluginName: a.name || null,
				version: a.version || null,
				installed: false,
				enabled: false,
				debug: false,
				available: true,
			})
		}
		return Array.from(byName.values())
	}

	/**
	 * Boot-load — exec every enabled record straight from IndexedDB. No network.
	 * Failures are isolated (one broken plugin doesn't block the rest). Returns
	 * a summary `{ loaded, failed }`.
	 */
	async function bootLoad() {
		let records
		try { records = await dbGetAll(W) }
		catch (e) { warn('[plugin-store] bootLoad: IndexedDB read failed:', e.message); return { loaded: 0, failed: 0 } }

		const enabled = records.filter(r => r.enabled && r.source)
		if (!enabled.length) return { loaded: 0, failed: 0 }

		log(`[plugin-store] boot-load: ${enabled.length} enabled plugin(s) from IndexedDB`)
		let loaded = 0, failed = 0
		for (const rec of enabled) {
			try {
				const manifest = await exec(rec.source)
				loaded++
				log(`[plugin-store]   ✓ ${rec.name} (${manifest.name} v${manifest.version || '?'})`)
			} catch (e) {
				failed++
				err(`[plugin-store]   ✗ ${rec.name}: ${e.message}`)
			}
		}
		log(`[plugin-store] boot-load done — ${loaded} loaded, ${failed} failed`)
		return { loaded, failed }
	}

	/**
	 * Uninstall a plugin by slug : tear down the live registration (if enabled)
	 * and delete the IndexedDB record. A slug that isn't installed resolves
	 * `{ ok:false }` rather than throwing.
	 */
	async function uninstall(name) {
		const rec = await dbGet(W, name)
		if (!rec) { warn(`[plugin-store] uninstall '${name}': not installed`); return { ok: false, name, error: 'not installed' } }
		if (rec.enabled && rec.pluginName) await PluginManager.unregister(rec.pluginName)
		await dbDelete(W, name)
		log(`[plugin-store ✓] uninstalled '${name}' (${rec.pluginName || '?'}) — removed from IndexedDB`)
		return { ok: true, name, pluginName: rec.pluginName }
	}

	/**
	 * Disable a plugin : tear down its live registration and flag the record
	 * `enabled:false` so it is skipped at boot. Source is retained for a later
	 * re-enable. No-op (warn) if the slug isn't installed.
	 */
	async function disable(name) {
		const rec = await dbGet(W, name)
		if (!rec) { warn(`[plugin-store] disable '${name}': not installed`); return { ok: false, name, error: 'not installed' } }
		if (rec.pluginName) await PluginManager.unregister(rec.pluginName)  // safe noop if already gone
		rec.enabled = false
		await dbPut(W, rec)
		log(`[plugin-store ✓] disabled '${name}' (${rec.pluginName || '?'})`)
		return { ok: true, name, pluginName: rec.pluginName, version: rec.version }
	}

	/**
	 * Enable a plugin : re-exec its stored source live and flag the record
	 * `enabled:true`. Unregisters first ONLY if already registered (avoids the
	 * "not registered — noop" warn on the common re-enable path) so re-enabling
	 * stays idempotent and doesn't leak the prior instance's lifecycle cleanups.
	 * The `enabled:true` flag is persisted ONLY after exec succeeds.
	 */
	async function enable(name) {
		const rec = await dbGet(W, name)
		if (!rec) { warn(`[plugin-store] enable '${name}': not installed`); return { ok: false, name, error: 'not installed' } }
		if (!rec.source) { warn(`[plugin-store] enable '${name}': no stored source`); return { ok: false, name, error: 'no source' } }
		if (rec.pluginName && PluginManager.list().some(p => p.name === rec.pluginName)) {
			await PluginManager.unregister(rec.pluginName)
		}
		const manifest = await exec(rec.source)   // throws on bad source — record left enabled:false
		rec.enabled = true
		rec.pluginName = manifest.name             // resync in case source changed since install
		rec.version = manifest.version || rec.version
		await dbPut(W, rec)
		log(`[plugin-store ✓] enabled '${name}' (${manifest.name} v${manifest.version || '?'})`)
		return { ok: true, name, pluginName: manifest.name, version: manifest.version }
	}

	/**
	 * Update (alias: refresh) — re-fetch the plugin's source from its stored
	 * `sourceUrl`, persist the new source/version, and (if enabled) re-exec it
	 * live. The fetch happens FIRST : a network failure throws with the old
	 * record fully intact. For an enabled plugin the OLD pluginName is
	 * unregistered and the NEW one stored. For a disabled plugin only the source
	 * is refreshed.
	 */
	async function update(name) {
		const rec = await dbGet(W, name)
		if (!rec) { warn(`[plugin-store] update '${name}': not installed`); return { ok: false, name, error: 'not installed' } }
		if (!rec.sourceUrl) { warn(`[plugin-store] update '${name}': no sourceUrl`); return { ok: false, name, error: 'no sourceUrl' } }

		log(`[plugin-store] update '${name}' from ${rec.sourceUrl}`)
		const source = await fetchText(rec.sourceUrl)   // network failure ⇒ throw, old state intact
		const oldVersion = rec.version

		if (rec.enabled) {
			if (rec.pluginName) await PluginManager.unregister(rec.pluginName)  // tear down OLD
			const manifest = await exec(source)                                 // register NEW
			rec.source = source
			rec.version = manifest.version || null
			rec.pluginName = manifest.name      // NEW manifest name (may differ from old)
			await dbPut(W, rec)
			log(`[plugin-store ✓] updated '${name}' (${manifest.name}) ${oldVersion || '?'} → ${manifest.version || '?'} — live`)
			return { ok: true, name, pluginName: manifest.name, version: manifest.version, oldVersion }
		}

		// disabled : refresh stored source only ; pluginName/version resync on next enable()
		rec.source = source
		await dbPut(W, rec)
		log(`[plugin-store ✓] updated '${name}' source (disabled — not exec'd)`)
		return { ok: true, name, pluginName: rec.pluginName, version: rec.version, oldVersion }
	}

	/** Alias — `update` reads better for a single plugin, `refresh` for ergonomics. */
	const refresh = update

	/**
	 * Refresh every installed plugin via update(). Failures are isolated. Returns
	 * a summary `{ updated, failed, results }`.
	 */
	async function refreshAll() {
		let records
		try { records = await dbGetAll(W) }
		catch (e) { warn('[plugin-store] refreshAll: IndexedDB read failed:', e.message); return { updated: 0, failed: 0, results: [] } }
		if (!records.length) return { updated: 0, failed: 0, results: [] }

		log(`[plugin-store] refresh-all: ${records.length} installed plugin(s)`)
		let updated = 0, failed = 0
		const results = []
		for (const rec of records) {
			try {
				const r = await update(rec.name)
				if (r.ok) updated++; else failed++
				results.push(r)
			} catch (e) {
				failed++
				results.push({ ok: false, name: rec.name, error: e.message })
				err(`[plugin-store]   ✗ ${rec.name}: ${e.message}`)
			}
		}
		log(`[plugin-store] refresh-all done — ${updated} updated, ${failed} failed`)
		return { updated, failed, results }
	}

	return { list, listInstalled, available, install, installFromSource, bootLoad, uninstall, disable, enable, update, refresh, refreshAll, DEFAULT_ORIGIN }
}
