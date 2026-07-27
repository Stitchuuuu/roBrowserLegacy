/**
 * Hello — demo plugin proving the native DI path (session 1: spike-core).
 *
 * Pure dependency injection: no imports of engine modules, no globals. The
 * NativePluginManager hands the engine modules in via `init(pars, diMap)`.
 * Zero imports → nothing to bundle, so this hand-authored file IS the shipped
 * `.esm.js` (an esbuild + `.d.ts` pipeline is deferred to a plugin that needs
 * one). Referenced from `ROConfig.plugins`.
 *
 * Timing note: the manager runs at boot (login screen), where the ChatBox DOM
 * is not mounted yet — an `addText` there is silently dropped. So we defer the
 * output to `ChatBox.onAppend` (fires once the ChatBox is mounted in-map).
 * Sessions 2+ replace this ad-hoc hook with the `lifecycle`/`event-bus` libs.
 */

export default {
	name: 'Hello',

	/**
	 * @param {*} pars - the `pars` from the ROConfig.plugins entry (unused here)
	 * @param {object} deps - injected engine modules (DI map)
	 * @returns {boolean} truthy on success
	 */
	init(pars, deps) {
		const ChatBox = deps.ChatBox;

		const say = () => {
			ChatBox.addText('hello from native plugin', ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
			// No-crash contract: a key that was never injected reads as undefined,
			// it does not throw.
			ChatBox.addText('no-crash OK: NonInjected is ' + typeof deps.NonInjected, ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
		};

		if (ChatBox.__active) {
			say();
		} else {
			// Wrap onAppend once so our lines land after the ChatBox is mounted.
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
	}
};
