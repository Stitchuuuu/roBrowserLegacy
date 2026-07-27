/**
 * lpm-consumer — a verification-only plugin (not part of the shipped set).
 *
 * Declares `deps: ['LocalPluginManager']` to prove LocalPluginManager's exported
 * API reaches the DI map via the cross-plugin export rule (a producer's
 * init()-return is the DI value keyed by its name). Prints the resolved API
 * surface to the ChatBox using the `onAppend` mount hook, because the ChatBox
 * isn't mounted yet at plugin-init time. Zero imports, pure DI.
 */

export default {
	name: 'LpmConsumer',
	deps: ['LocalPluginManager'],

	init(pars, deps) {
		const ChatBox = deps.ChatBox;
		const LPM = deps.LocalPluginManager;

		const has = LPM && typeof LPM.list === 'function' && typeof LPM.onChange === 'function';
		const line = `[LpmConsumer] deps.LocalPluginManager.list = ${LPM ? typeof LPM.list : 'undefined'}`
			+ ` (API ${has ? 'present' : 'MISSING'})`;

		const say = () => {
			ChatBox.addText(line, ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
		};

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
