/**
 * tests/plugins/ui.playerWindow.test.js
 *
 * A plugin window across a map transition: it follows the native map windows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ components: {} }));

vi.mock('Plugins/native-manager/libs/plugin-api.js', () => ({
	UIManager: { components: mocks.components },
	Preferences: { get: (_key, defaults) => ({ ...defaults, save() {} }) }
}));
vi.mock('Plugins/native-manager/libs/lifecycle.js', () => ({ hasReached: () => false, registerCleanup: () => {} }));

const { registerPlayerWindow } = await import('Plugins/native-manager/libs/ui.js');
const { emit, EVENTS } = await import('Plugins/native-manager/libs/event-bus.js');

let seq = 0;

/**
 * A panel whose remove() detaches it, as UIManager.removeComponents() does
 */
function panel() {
	const host = document.createElement('div');
	return {
		name: `TestPanel${++seq}`,
		ui: [host],
		append: vi.fn(() => document.body.appendChild(host)),
		remove: () => host.remove()
	};
}

/**
 * The map transition: windows the engine does not keep are removed
 */
async function leaveMap(chatKept) {
	emit(EVENTS.MAP_LEAVE);
	for (const name in mocks.components) {
		if (name !== 'ChatBox' || !chatKept) {
			mocks.components[name].remove();
		}
	}
	await Promise.resolve();
}

describe('a plugin window across a map transition', () => {
	let chat;

	beforeEach(() => {
		document.body.innerHTML = '';
		for (const name in mocks.components) {
			delete mocks.components[name];
		}
		chat = panel();
		chat.name = 'ChatBox';
		chat.append();
		mocks.components.ChatBox = chat;
	});

	it('comes straight back when the engine keeps its own windows attached', async () => {
		const window = panel();
		registerPlayerWindow(() => window);
		emit(EVENTS.MAP_READY);

		await leaveMap(true);

		expect(window.ui[0].isConnected).toBe(true);
		expect(window.append).toHaveBeenCalledTimes(2);
	});

	it('waits for the map to be ready when the engine removes its windows', async () => {
		const window = panel();
		registerPlayerWindow(() => window);
		emit(EVENTS.MAP_READY);

		await leaveMap(false);
		expect(window.ui[0].isConnected).toBe(false);

		emit(EVENTS.MAP_READY);
		expect(window.ui[0].isConnected).toBe(true);
	});

	it('comes back once, with the map, when the engine removes it at black', async () => {
		const window = panel();
		registerPlayerWindow(() => window);
		emit(EVENTS.MAP_READY);

		emit(EVENTS.MAP_LEAVE);
		await Promise.resolve();
		window.remove();
		expect(window.ui[0].isConnected).toBe(false);

		emit(EVENTS.MAP_READY);
		expect(window.ui[0].isConnected).toBe(true);
		expect(window.append).toHaveBeenCalledTimes(2);
	});
});
