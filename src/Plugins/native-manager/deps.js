/**
 * Native Plugin Manager — dependency resolution (session 3: deps-di-exports).
 *
 * Two pure functions, deliberately zero-import so they unit-test in Node
 * (`index.js` is coupled to browser-only modules and can't be) :
 *   - `topoSort`          — order plugins so a declared dep inits first.
 *   - `resolveDepExports` — build the cross-plugin DI map a consumer receives.
 *
 * Both operate on plain objects/arrays and never throw — a missing dep is a
 * non-edge / an omitted key, never an exception (no-crash contract).
 */

/**
 * Order plugin entries so that a plugin's declared `deps` init before it.
 *
 * Kahn's algorithm. An edge `D → C` exists only when `D` is a **present**
 * entry — a dep naming a plugin that isn't loaded creates no edge, so the
 * consumer still orders (and its DI entry for that dep reads `undefined`).
 * Config order is preserved among independent (ready) nodes.
 *
 * @param {Array<{ name: string, def?: { deps?: string[] } }>} entries
 * @returns {{ ordered: Array<object>, cyclic: string[] }}
 *   `ordered` = topologically sorted entries ; `cyclic` = names of entries
 *   caught in a dependency cycle (never reached in-degree 0), excluded from
 *   `ordered` so the caller can skip them without hanging.
 */
export function topoSort(entries) {
	// null-proto lookup maps: plugin names are author-controlled, so a name
	// like `constructor` / `__proto__` must not resolve to an inherited member
	// (which would forge a phantom edge → false cycle).
	const byName = Object.create(null);
	for (let i = 0; i < entries.length; i++) {
		byName[entries[i].name] = entries[i];
	}

	// in-degree per node + adjacency producer → [consumers]
	const indeg = Object.create(null);
	const adj = Object.create(null);
	for (let i = 0; i < entries.length; i++) {
		const name = entries[i].name;
		if (indeg[name] === undefined) {
			indeg[name] = 0;
		}
		const def = entries[i].def;
		const deps = def && Array.isArray(def.deps) ? def.deps : [];
		for (let j = 0; j < deps.length; j++) {
			const d = deps[j];
			if (byName[d]) {              // only present producers create an edge
				(adj[d] || (adj[d] = [])).push(name);
				indeg[name] = (indeg[name] || 0) + 1;
			}
		}
	}

	// seed the queue in config order, append newly-ready in discovery order
	const queue = [];
	for (let i = 0; i < entries.length; i++) {
		if (indeg[entries[i].name] === 0) {
			queue.push(entries[i].name);
		}
	}

	const ordered = [];
	const placed = Object.create(null);
	while (queue.length) {
		const n = queue.shift();
		ordered.push(byName[n]);
		placed[n] = true;
		const outs = adj[n] || [];
		for (let k = 0; k < outs.length; k++) {
			const c = outs[k];
			indeg[c] -= 1;
			if (indeg[c] === 0) {
				queue.push(c);
			}
		}
	}

	// nodes never placed are in a cycle
	const cyclic = [];
	for (let i = 0; i < entries.length; i++) {
		if (!placed[entries[i].name]) {
			cyclic.push(entries[i].name);
		}
	}

	return { ordered, cyclic };
}

/**
 * Build the cross-plugin export map injected into a consumer's DI map.
 *
 * For each declared dep, the entry is the producer's `init()`-return when it
 * returned a value (stateful case wins), else the producer module namespace
 * (default). A dep whose producer wasn't loaded is **omitted** — so the DI
 * lookup reads `undefined` and the consumer null-checks (no-crash).
 *
 * @param {string[]} depNames   the consumer's `deps` array
 * @param {Object<string, *>} results     init()-returns keyed by plugin name
 * @param {Object<string, *>} namespaces  module namespaces keyed by plugin name
 * @returns {Object<string, *>}
 */
export function resolveDepExports(depNames, results, namespaces) {
	const out = Object.create(null);
	if (!Array.isArray(depNames)) {
		return out;
	}
	for (let i = 0; i < depNames.length; i++) {
		const d = depNames[i];
		// `namespaces` / `results` are null-proto (built by the caller / registry),
		// so `d in namespaces` and `results[d]` can't hit an inherited member.
		if (d in namespaces) {          // producer was loaded
			out[d] = results[d] !== undefined ? results[d] : namespaces[d];
		}
		// absent producer → key omitted → diMap[d] reads undefined
	}
	return out;
}
