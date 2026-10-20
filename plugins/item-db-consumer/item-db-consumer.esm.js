/**
 * item-db-consumer — a verification-only plugin (not part of the shipped set).
 *
 * Declares `deps: ['ItemDb']` to prove ItemDb's exported API reaches the DI map
 * via the cross-plugin export rule. Prints Red Potion's name + the item count
 * to the ChatBox using the `onAppend` mount hook, because the ChatBox isn't
 * mounted yet at plugin-init time. Zero imports, pure DI.
 */

/** @type {import('../native-manager.d.ts').NativePlugin} */
export default {
	name: 'ItemDbConsumer',
	deps: ['ItemDb'],

	async init(pars, deps) {
		const ChatBox = deps.ChatBox;
		const ItemDb = deps.ItemDb;

		const say = (line) => {
			ChatBox.addText(line, ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
		};

		let line;
		if (!ItemDb) {
			line = '[ItemDbConsumer] deps.ItemDb is undefined (ItemDb not loaded)';
		} else {
			await ItemDb.ready;
			const redPotion = ItemDb.get(501);
			line = `[ItemDbConsumer] get(501) = ${redPotion ? redPotion.name : 'null'}, count() = ${ItemDb.count()}`;
		}

		if (ChatBox.__active) {
			say(line);
		} else {
			const originalOnAppend = ChatBox.onAppend;
			let printed = false;
			ChatBox.onAppend = function onAppend() {
				const ret = originalOnAppend ? originalOnAppend.apply(this, arguments) : undefined;
				if (!printed) {
					printed = true;
					say(line);
				}
				return ret;
			};
		}

		return true;
	},
};
