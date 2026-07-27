/**
 * Native Plugin Manager — registry (session 1: spike-core).
 *
 * Registers a plugin's default export `{ name, deps, init }` and runs its
 * `init(pars, diMap)`. The DI map is a plain object spread from ENGINE, so an
 * absent key reads as `undefined` — never a thrown exception (no-crash
 * contract, e.g. a plugin that reads a not-yet-native module still loads).
 *
 * Deliberately minimal: no queue, no `deps` topo-sort (session 3), no libs
 * (session 2). Only the DI path.
 */

import { ENGINE } from 'Plugins/native-manager/engine-modules.js';

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

	const diMap = { ...ENGINE };
	const ret = def.init(pars, diMap);

	if (def.name) {
		results[def.name] = ret;
	}

	return ret;
}
