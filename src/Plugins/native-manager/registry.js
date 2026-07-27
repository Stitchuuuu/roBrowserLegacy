/**
 * Native Plugin Manager — registry.
 *
 * Registers a plugin's default export `{ name, deps, init }` and runs its
 * `init(pars, diMap)`. The DI map is built by `buildDiMap()` (engine modules +
 * native libs); an absent key reads as `undefined` — never a thrown exception
 * (no-crash contract, e.g. a plugin that reads a not-yet-native module still
 * loads).
 *
 * Deliberately minimal: no queue, no `deps` topo-sort (session 3). Only the DI
 * path + per-plugin cleanup ownership.
 */

import { buildDiMap } from 'Plugins/native-manager/di.js';

/**
 * Collected `init()` return values, keyed by plugin name. Later sessions
 * inject stateful plugin APIs (init()-return) into downstream DI maps.
 * @type {Object<string, *>}
 */
export const results = {};

/**
 * Register a plugin default export and invoke its init with the DI map.
 *
 * @param {{ name?: string, init: Function }} def - plugin default export
 * @param {*} pars - the `pars` from its ROConfig.plugins entry (or null)
 * @returns {*} the init() return value, or false if the shape is invalid
 */
export function register(def, pars) {
	if (!def || typeof def.init !== 'function') {
		return false;
	}

	const diMap = buildDiMap();

	// Scope registerCleanup() calls made synchronously during init to this
	// plugin, so lifecycle can flush them per-plugin later (matches the v3
	// PluginManager owner-scoping). Cleared in a finally so a throw can't leak
	// the owner onto the next registration.
	const lc = diMap.lifecycle;
	const canScope = lc && typeof lc.setCurrentPlugin === 'function';
	if (canScope) {
		lc.setCurrentPlugin(def.name || null);
	}
	let ret;
	try {
		ret = def.init(pars, diMap);
	} finally {
		if (canScope) {
			lc.setCurrentPlugin(null);
		}
	}

	if (def.name) {
		results[def.name] = ret;
	}

	return ret;
}
