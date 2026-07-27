/**
 * Native Plugin Manager — registry.
 *
 * Registers a plugin's default export `{ name, deps, init }` and runs its
 * `init(pars, diMap)`. The DI map is built by `buildDiMap()` (engine modules +
 * native libs); an absent key reads as `undefined` — never a thrown exception
 * (no-crash contract, e.g. a plugin that reads a not-yet-native module still
 * loads).
 *
 * Ordering + cross-plugin export injection live in `index.js` / `deps.js`: the
 * caller topo-sorts by `deps` and passes the producer APIs as `pluginExports`.
 * This module owns the DI path + per-plugin cleanup ownership, and awaits init so
 * a stateful producer's API is resolved before a consumer registers.
 */

import { buildDiMap } from 'Plugins/native-manager/di.js';

/**
 * Collected `init()` return values, keyed by canonical plugin name. The loader
 * injects a stateful plugin's init()-return from here into its consumers' DI
 * maps. Null-proto so a plugin named `constructor` / `__proto__` can't collide
 * with an inherited member on lookup.
 * @type {Object<string, *>}
 */
export const results = Object.create(null);

/**
 * Register a plugin default export and invoke its init with the DI map.
 *
 * @param {{ name?: string, deps?: string[], init: Function }} def - plugin default export
 * @param {*} pars - the `pars` from its ROConfig.plugins entry (or null)
 * @param {Object<string, *>} [pluginExports] - producer APIs this plugin's
 *        `deps` resolve to, spread into its DI map
 * @param {string} [name] - canonical key (`def.name` or the config key) the
 *        loader uses for topo/exports; `results` + cleanup owner key by it so a
 *        nameless-default producer's init()-return still reaches its consumers
 * @returns {Promise<*>} the init() return value, or false if the shape is invalid
 */
export async function register(def, pars, pluginExports, name) {
	if (!def || typeof def.init !== 'function') {
		return false;
	}

	const key = name || def.name || null;
	const diMap = buildDiMap(pluginExports);

	// Scope registerCleanup() calls made during init to this plugin, so lifecycle
	// can flush them per-plugin later. The scope spans the awaited init — correct
	// because the caller registers sequentially, so no concurrent plugin can
	// clobber _currentPlugin. The finally RESTORES the previous owner (not null)
	// so a nested register — a plugin whose init() registers others (e.g. an
	// IndexedDB-backed manager restoring stored plugins) — leaves the outer
	// plugin's scope intact for any cleanups it registers after the nested call.
	const lc = diMap.lifecycle;
	const canScope = lc && typeof lc.setCurrentPlugin === 'function';
	const prevOwner = canScope ? lc.setCurrentPlugin(key) : null;
	let ret;
	try {
		ret = await def.init(pars, diMap);
	} finally {
		if (canScope) {
			lc.setCurrentPlugin(prevOwner);
		}
	}

	if (key) {
		results[key] = ret;
	}

	return ret;
}
