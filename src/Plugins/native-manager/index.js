/**
 * Native Plugin Manager — DI core singleton (session 1: spike-core).
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
 * Load is two-phase (session 3): collect every native plugin default, topo-sort
 * by `deps`, then register in order — injecting each producer's exported API
 * into its consumers' DI maps. Still no import-map, no IndexedDB.
 */

import Configs from 'Core/Configs.js';
import { register, results } from 'Plugins/native-manager/registry.js';
import { topoSort, resolveDepExports } from 'Plugins/native-manager/deps.js';

let _initialized = false;
let _initPromise = null;

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
 * Read `ROConfig.plugins`, import every native plugin default, topo-sort by
 * `deps`, then register in order — injecting each producer's export into its
 * consumers' DI maps. Per-entry try/catch: one bad plugin (incl. a fail-fast
 * missing hard dep) never breaks the rest of boot.
 * @returns {Promise<void>}
 */
async function run() {
	await awaitROConfig();

	const list = Configs.get('plugins', {});

	// ── Phase A : collect native plugin defaults (order-independent) ──
	const entries = [];
	for (const name in list) {
		const entry = resolveEntry(list[name]);
		if (!entry || !isNativeEntry(entry.url)) {
			continue; // malformed, or a v2-style entry the v2 manager owns
		}
		try {
			const mod = await import(/* @vite-ignore */ entry.url);
			const def = mod.default;
			if (!def || typeof def.init !== 'function') {
				// loaded but not a native plugin (no init) — diagnose, don't
				// let it vanish silently.
				console.error('[NativePM] Invalid plugin (missing init): ' + name);
				continue;
			}
			// canonical key: the default's own name wins, else the config key
			const key = def.name || name;
			entries.push({ name: key, def, mod, pars: entry.pars });
		} catch (err) {
			// import reject = a bad file OR a missing hard dep (an unresolved
			// static plugin specifier) — fail-fast, skip, keep booting.
			console.error('[NativePM] Failed to load plugin: ' + name, err);
		}
	}

	// ── Phase B : topo-sort by deps (producers before consumers) ──
	const { ordered, cyclic } = topoSort(entries);
	if (cyclic.length) {
		console.error('[NativePM] dependency cycle detected, skipping: ' + cyclic.join(', '));
	}

	// ── Phase C : register in order, injecting resolved dep exports ──
	// null-proto so a plugin named `constructor` / `__proto__` can't collide
	// with an inherited member when resolveDepExports probes it.
	const namespaces = Object.create(null);
	for (let i = 0; i < entries.length; i++) {
		namespaces[entries[i].name] = entries[i].mod;
	}
	for (let i = 0; i < ordered.length; i++) {
		const e = ordered[i];
		const deps = Array.isArray(e.def.deps) ? e.def.deps : [];
		const pluginExports = resolveDepExports(deps, results, namespaces);
		try {
			// def shape was validated in phase A, so register always runs init;
			// its return (even a legitimate `false`) is a successful load.
			await register(e.def, e.pars, pluginExports, e.name);
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
