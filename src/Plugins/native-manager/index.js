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
 * Scope: DI only. No import-map, no IndexedDB, no `deps` topo-sort, no libs.
 */

import Configs from 'Core/Configs.js';
import { register } from 'Plugins/native-manager/registry.js';

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
 * Read `ROConfig.plugins`, import each declared plugin, register it via DI.
 * Per-entry try/catch: one bad plugin never breaks the rest of boot.
 * @returns {Promise<void>}
 */
async function run() {
	await awaitROConfig();

	const list = Configs.get('plugins', {});

	for (const name in list) {
		const entry = resolveEntry(list[name]);
		if (!entry) {
			continue;
		}

		try {
			const mod = await import(/* @vite-ignore */ entry.url);
			if (register(mod.default, entry.pars) !== false) {
				console.log('[NativePM] registered: ' + name);
			}
		} catch (err) {
			console.error('[NativePM] Failed to load plugin: ' + name, err);
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
