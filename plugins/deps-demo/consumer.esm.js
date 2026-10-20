/**
 * deps-demo/consumer — native plugin manager, session-3 demo (consumer).
 *
 * Declares two deps :
 *   - `DepsDemoProducer` — present. Topo-sort inits it first; its `init()`-
 *     return is injected here as `deps.DepsDemoProducer`. Proves cross-plugin
 *     export → DI.
 *   - `OptionalAbsent`   — not loaded. The DI entry reads `undefined`; the
 *     consumer null-checks and degrades. Proves the no-crash optional contract.
 *
 * The export resolution happens synchronously at init (below). Output is
 * deferred to the ChatBox via the `onAppend` mount hook (the ChatBox isn't
 * mounted at boot, and WIRE_COMPLETE fires too early to rely on here — same
 * pattern as the session-1 hello demo). Zero imports, pure DI.
 */

export default {
	name: 'DepsDemoConsumer',
	deps: ['DepsDemoProducer', 'OptionalAbsent'],

	init(pars, deps) {
		const ChatBox = deps.ChatBox;

		// ── cross-plugin export : the producer's init()-return, injected ──
		const producer = deps.DepsDemoProducer;
		const fromProducer = producer && typeof producer.ping === 'function'
			? producer.ping()
			: '(producer missing)';

		// ── optional missing dep : undefined, no throw ──
		const optional = 'OptionalAbsent is ' + typeof deps.OptionalAbsent;

		const say = () => {
			ChatBox.addText('[DepsDemo] from producer: ' + fromProducer, ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
			ChatBox.addText('[DepsDemo] no-crash: ' + optional, ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
		};

		// ChatBox mounts in-map; defer until it is active (hello-demo pattern).
		if (ChatBox.__active) {
			say();
		} else {
			const originalOnAppend = ChatBox.onAppend;
			let printed = false;
			ChatBox.onAppend = function onAppend() {
				const ret = originalOnAppend ? originalOnAppend.apply(this, arguments) : undefined;
				if (!printed) {
					printed = true;
					say();
				}
				return ret;
			};
		}

		return true;
	},
};
