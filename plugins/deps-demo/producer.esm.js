/**
 * deps-demo/producer — native plugin manager, session-3 demo (producer).
 *
 * A **stateful** producer: it exposes its API by returning it from `init()`.
 * The manager collects that return in `results['DepsDemoProducer']` and, per
 * the cross-plugin rule, injects it (overriding the module namespace) into the
 * DI map of any plugin that declares `deps: ['DepsDemoProducer']`.
 *
 * Wire it AFTER its consumer in ROConfig.plugins to prove topo-sort reorders
 * so this producer still inits first. Zero imports, pure DI.
 */

export default {
	name: 'DepsDemoProducer',

	init() {
		let calls = 0;
		// The stateful API handed to consumers via the DI map.
		return {
			ping() {
				calls += 1;
				return 'pong #' + calls + ' @' + Date.now();
			},
		};
	},
};
