/**
 * deps-demo/hard-missing — native plugin manager, session-3 demo (hard dep).
 *
 * A **hard** dependency is a static plugin specifier the manager resolves via
 * an import-map (a later session — local-plugin-manager). When the producer is
 * absent, that specifier fails to resolve, the module throws at load, the
 * manager's `import()` rejects, and the plugin is skipped with a clear
 * `[NativePM]` error while the app keeps booting — the fail-fast contract.
 *
 * We can't ship the real static specifier here : the dev server's import
 * analysis rejects an unresolved bare specifier at transform-time (a blocking
 * overlay), long before the browser or the manager run — and the import-map
 * that would resolve it doesn't exist yet. So this demo reproduces the exact
 * behaviour that matters — a module that throws at load → the manager's Phase A
 * catch skips it and boots on — with a top-level throw instead.
 */

throw new Error('[HardMissing] simulated missing hard dependency (unresolved plugin specifier)');

// eslint-disable-next-line no-unreachable
export default {
	name: 'HardMissing',
	init() {},
};
