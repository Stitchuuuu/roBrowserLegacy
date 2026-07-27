/**
 * Native Plugin Manager — dependency-injection plugin host (singleton).
 *
 * Loads any ESM plugin (`export default { name, deps, init }`) declared in
 * `ROConfig.plugins` and hands it the engine modules via `init(pars, diMap)` —
 * clean dependency injection, no proxies, no ambient global. Coexists with the
 * untouched v2 `src/Plugins/PluginManager.js` (which reads the same `plugins`
 * key but only handles function-shaped defaults).
 *
 * Idempotent across the 3 boot call sites (Online/Login/Map): the guard is
 * module-scoped state (an ESM module is a singleton), so no window global is
 * needed — which also keeps the src/ coexistence grep gate clean.
 *
 * Load is two-phase: collect every native plugin default, topo-sort by `deps`,
 * then register in order — injecting each producer's exported API into its
 * consumers' DI maps.
 *
 * Every plugin's DI map also carries a runtime host (`PluginHost = { register,
 * unregister, list }`) so a plugin can register / restore / tear down OTHER
 * plugins at (and after) boot. A plugin listed last can therefore install or
 * restore further plugins during its own init and have them resolve deps against
 * the fully-registered set (that's how the IndexedDB-backed LocalPluginManager
 * plugin re-loads stored plugins). No import-map.
 */

import Configs from 'Core/Configs.js';
import { register, results } from 'Plugins/native-manager/registry.js';
import { topoSort, resolveDepExports } from 'Plugins/native-manager/deps.js';
import * as lifecycle from 'Plugins/native-manager/libs/lifecycle.js';

let _initialized = false;
let _initPromise = null;

// Module-scoped registration state so the runtime host (below) can register /
// unregister plugins AFTER boot — the path LocalPluginManager's IndexedDB store
// drives (install / drag-drop / bootLoad). `namespaces` maps a plugin name → its
// module namespace (the dep-fallback export when a producer has no init()-return);
// `registered` is the live set of registered plugin names. Both null-proto —
// plugin names are author-controlled, so a name like `constructor` / `__proto__`
// must not resolve to an inherited member.
const namespaces = Object.create(null);
const registered = Object.create(null);

/**
 * Resolve once `window.ROConfig` exists. In INLINE/direct mode it is set
 * before `main.js` imports (available synchronously); in API/postMessage mode
 * it arrives later — poll until it does.
 * @returns {Promise<void>}
 */
function awaitROConfig() {
	if (window.ROConfig) {
		return Promise.resolve();
	}
	return new Promise(resolve => {
		const check = () => {
			if (window.ROConfig) {
				resolve();
			} else {
				setTimeout(check, 15);
			}
		};
		check();
	});
}

/**
 * Normalize a `ROConfig.plugins` entry to `{ url, pars }`.
 * String → URL only; object → `{ path, pars }`. Anything else → null (skip).
 * @param {*} value
 * @returns {{ url: string, pars: * } | null}
 */
function resolveEntry(value) {
	if (typeof value === 'string' || value instanceof String) {
		return { url: String(value), pars: null };
	}
	if (value && typeof value === 'object' && value.path) {
		return { url: value.path, pars: value.pars || null };
	}
	return null;
}

/**
 * Discriminate a native entry from a v2 one before importing. Native plugins
 * are served at a stable absolute URL (`/plugins/…` or `http(s)://…`); v2
 * entries are bare relative paths resolved under `src/Plugins/` by the v2
 * manager. Skipping the v2 ones here spares a benign `import(url)` failure per
 * boot on a mixed config (the v2 manager still handles them). We don't touch
 * v2, so its own 404 on native URLs is left as-is.
 * @param {string} url
 * @returns {boolean}
 */
function isNativeEntry(url) {
	return url[0] === '/' || url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Import a native plugin entry and validate its default export.
 * @param {string} url
 * @param {*} pars
 * @param {string} configName - the ROConfig key (logging + fallback name)
 * @returns {Promise<{name:string, def:object, mod:object, pars:*}|null>} a
 *          collectable entry, or null (logged) on import failure / mis-shape.
 */
async function collectEntry(url, pars, configName) {
	try {
		const mod = await import(/* @vite-ignore */ url);
		const def = mod.default;
		if (!def || typeof def.init !== 'function') {
			// loaded but not a native plugin (no init) — diagnose, don't let it
			// vanish silently.
			console.error('[NativePM] Invalid plugin (missing init): ' + configName);
			return null;
		}
		// canonical key: the default's own name wins, else the config key
		return { name: def.name || configName, def, mod, pars };
	} catch (err) {
		// import reject = a bad file OR a missing hard dep (an unresolved static
		// plugin specifier) — fail-fast, skip, keep booting.
		console.error('[NativePM] Failed to load plugin: ' + configName, err);
		return null;
	}
}

function _noop() {
	// swallow a serialized registration's outcome for the lock chain (below)
}

/**
 * Do the runtime registration: resolve the plugin's declared deps against the
 * live registry, register it (awaiting init), record it.
 * @param {{ name:string, deps?:string[], init:Function }} def
 * @param {*} pars
 * @param {object} [mod] the imported module namespace (dep-fallback export)
 * @returns {Promise<*>} the plugin's init()-return
 */
async function _doRegisterRuntime(def, pars, mod) {
	if (!def || typeof def.init !== 'function') {
		throw new Error('[NativePM] runtime register: invalid plugin (missing init)');
	}
	const key = def.name;
	if (mod) {
		namespaces[key] = mod;
	}
	const deps = Array.isArray(def.deps) ? def.deps : [];
	const pluginExports = resolveDepExports(deps, results, namespaces);
	pluginExports.PluginHost = HOST; // a runtime plugin can install others too
	const ret = await register(def, pars, pluginExports, key);
	registered[key] = true;
	console.log('[NativePM] registered: ' + key);
	return ret;
}

// Serialize runtime registrations. Owner-scoping (`_currentPlugin` in lifecycle)
// is a single mutable var, safe only for SEQUENTIAL registration — the boot loop
// and a single bootLoad() are sequential by construction, but independent runtime
// installs (two `/pm install`, two file drops, a future "install all") could
// overlap and mis-attribute a plugin's cleanups to another owner. This chain
// makes runtime register() calls never interleave; each caller still gets its own
// result/error (the chain only gates ordering, `_noop` isolates failures).
let _runtimeChain = Promise.resolve();

/**
 * Register a plugin at runtime (after boot) — the path LocalPluginManager's
 * IndexedDB store uses for install / drag-drop / bootLoad. Runtime plugins arrive
 * as blob-imported modules, so they never pass through the config-url
 * `isNativeEntry` filter. Serialized (see `_runtimeChain`).
 * @param {{ name:string, deps?:string[], init:Function }} def
 * @param {*} [pars]
 * @param {object} [mod] the imported module namespace (dep-fallback export)
 * @returns {Promise<*>} the plugin's init()-return
 */
function registerRuntime(def, pars, mod) {
	const run = () => _doRegisterRuntime(def, pars, mod);
	const result = _runtimeChain.then(run, run); // run regardless of prior outcome
	_runtimeChain = result.then(_noop, _noop);   // next waits, ignoring our result
	return result;
}

/**
 * Tear down a runtime plugin: flush the cleanups it registered (owner-scoped via
 * lifecycle) and drop it from the registry. Best-effort — a plugin that
 * registered no cleanups leaves no residue to flush.
 * @param {string} name
 */
function unregisterRuntime(name) {
	lifecycle.flushCleanup('unload', name);
	delete results[name];
	delete namespaces[name];
	delete registered[name];
}

/**
 * Live registered plugins, as `[{ name }]` — the array form a caller can probe
 * with `.some(p => p.name === …)` before registering/unregistering.
 * @returns {Array<{name:string}>}
 */
function listRuntime() {
	return Object.keys(registered).map(name => ({ name }));
}

/**
 * Runtime registration capability injected into every plugin's DI map (as
 * `PluginHost`): `register(def, pars?, mod?)`, `unregister(name)`, `list()` — the
 * interface a plugin uses to register or tear down OTHER plugins after boot.
 */
const HOST = {
	register: registerRuntime,
	unregister: unregisterRuntime,
	list: listRuntime,
};

/**
 * Collect every `ROConfig.plugins` native default, topo-sort by `deps`, then
 * register in order — injecting each producer's export into its consumers' DI
 * maps, plus the runtime host (`PluginHost`) into every plugin's. Per-entry
 * try/catch: one bad plugin never breaks the rest of boot.
 * @returns {Promise<void>}
 */
async function run() {
	await awaitROConfig();

	// ── Phase A : collect native plugin defaults (order-independent) ──
	const entries = [];
	const list = Configs.get('plugins', {});
	for (const name in list) {
		const entry = resolveEntry(list[name]);
		if (!entry || !isNativeEntry(entry.url)) {
			continue; // malformed, or a v2-style entry the v2 manager owns
		}
		const collected = await collectEntry(entry.url, entry.pars, name);
		if (collected) {
			entries.push(collected);
		}
	}

	// ── Phase B : topo-sort by deps (producers before consumers) ──
	const { ordered, cyclic } = topoSort(entries);
	if (cyclic.length) {
		console.error('[NativePM] dependency cycle detected, skipping: ' + cyclic.join(', '));
	}

	// ── Phase C : register in order, injecting resolved dep exports ──
	for (let i = 0; i < entries.length; i++) {
		namespaces[entries[i].name] = entries[i].mod;
	}
	for (let i = 0; i < ordered.length; i++) {
		const e = ordered[i];
		const deps = Array.isArray(e.def.deps) ? e.def.deps : [];
		const pluginExports = resolveDepExports(deps, results, namespaces);
		pluginExports.PluginHost = HOST; // any plugin may register others (LPM does)
		try {
			// def shape was validated in phase A, so register always runs init;
			// its return (even a legitimate `false`) is a successful load.
			await register(e.def, e.pars, pluginExports, e.name);
			registered[e.name] = true;
			console.log('[NativePM] registered: ' + e.name);
		} catch (err) {
			console.error('[NativePM] Plugin init failed: ' + e.name, err);
		}
	}
}

const NativePluginManager = {
	/**
	 * Idempotent async init. Safe to call at every boot site — only the first
	 * call does work; subsequent calls return the same in-flight promise.
	 * @returns {Promise<void>}
	 */
	init() {
		if (_initialized) {
			return _initPromise;
		}
		_initialized = true;
		_initPromise = run();
		return _initPromise;
	}
};

export default NativePluginManager;
