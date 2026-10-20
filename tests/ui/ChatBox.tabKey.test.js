import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class MockGUIComponent {
		constructor(name) {
			this.name = name;
			this._host = document.createElement('div');
			this.ui = { show: vi.fn(), hide: vi.fn(), is: vi.fn(() => true) };
		}

		getRoot() {
			return this._host;
		}

		draggable() {}

		focus() {}

		parseHTML() {}
	}
	MockGUIComponent.MouseMode = { CROSS: 'cross', DEFAULT: 'default' };

	return { MockGUIComponent };
});

vi.mock('DB/DBManager.js', () => ({
	default: {
		INTERFACE_PATH: '',
		getMessage: (id, defaultText) => (defaultText !== undefined ? defaultText : `NO MSG ${id}`)
	}
}));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800, tick: 0, render: vi.fn(), stop: vi.fn() } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { get: vi.fn(), getOverEntity: vi.fn() } }));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile(_path, callback) {
			callback?.('');
		},
		loadFiles(_paths, callback) {
			callback?.('');
		}
	}
}));
vi.mock('Core/Events.js', () => ({ default: { setTimeout: vi.fn(), clearTimeout: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({
	default: {
		get: (_name, defaults) => ({ ...defaults, save: vi.fn() })
	}
}));
vi.mock('Core/Configs.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Controls/MouseEventHandler.js', () => ({ default: { screen: { x: 0, y: 0 } } }));
vi.mock('Controls/BattleMode.js', () => ({ default: { process: vi.fn(() => false) } }));
vi.mock('Controls/ProcessCommand.js', () => ({ default: vi.fn() }));
vi.mock('UI/CursorManager.js', () => ({ default: { setType: vi.fn(), ACTION: {} } }));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c, showMessageBox: vi.fn() } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/ContextMenu/ContextMenu.js', () => ({
	default: { remove: vi.fn(), append: vi.fn(), addElement: vi.fn() }
}));
vi.mock('UI/Components/ChatBoxSettings/ChatBoxSettings.js', () => ({
	default: { updateTab: vi.fn(), getTabs: () => [] }
}));

// KEYS is deliberately NOT mocked: `getDeepActiveElement` is installed with
// Object.defineProperty({ writable: false }), so a mock of it would be a
// different function than the one shipping, and the shadow-piercing walk is
// exactly what this guard depends on.
const ChatBox = (await import('UI/Components/ChatBox/ChatBox.js')).default;
const KEYS = (await import('Controls/KeyEventHandler.js')).default;

function mountChatBox() {
	const host = document.createElement('div');
	host.innerHTML = ChatBox.render();
	document.body.appendChild(host);
	ChatBox._host = host;
	ChatBox._shadow = null;
	return host;
}

function tabEvent(target) {
	return {
		which: KEYS.TAB,
		key: 'Tab',
		target,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
		getModifierState: () => false
	};
}

describe('ChatBox — Tab between the user name and the message input', () => {
	let root;

	beforeEach(() => {
		document.body.innerHTML = '';
		root = mountChatBox();
	});

	// Without this case Tab fell to the browser's focus navigation and left
	// the chat for whatever control came next in the page.
	it('moves focus from the message input to the user name', () => {
		const messageBox = root.querySelector('.input-chatbox');
		const nickBox = root.querySelector('.input .username');
		messageBox.focus();

		const event = tabEvent(messageBox);
		expect(ChatBox.onKeyDown(event)).toBe(false);
		expect(KEYS.getDeepActiveElement()).toBe(nickBox);
		expect(event.stopImmediatePropagation).toHaveBeenCalled();
	});

	it('moves focus from the user name back to the message input', () => {
		const messageBox = root.querySelector('.input-chatbox');
		const nickBox = root.querySelector('.input .username');
		nickBox.focus();

		const event = tabEvent(nickBox);
		expect(ChatBox.onKeyDown(event)).toBe(false);
		expect(KEYS.getDeepActiveElement()).toBe(messageBox);
	});

	it('leaves Tab alone when the chat is not focused', () => {
		document.body.focus();

		const event = tabEvent(document.body);
		expect(ChatBox.onKeyDown(event)).toBe(true);
		expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
	});
});
