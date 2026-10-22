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

	return { MockGUIComponent, ItemInfo: { append: vi.fn(), setItem: vi.fn() } };
});

vi.mock('DB/DBManager.js', () => ({
	default: {
		INTERFACE_PATH: '',
		getMessage: (id, defaultText) => (defaultText !== undefined ? defaultText : `NO MSG ${id}`),
		parseItemLink: () => ({ name: 'Red Potion' })
	}
}));
vi.mock('Renderer/Renderer.js', () => ({
	default: { width: 1200, height: 800, tick: 0, render: vi.fn(), stop: vi.fn() }
}));
vi.mock('Renderer/EntityManager.js', () => ({
	default: { get: vi.fn(), getOverEntity: vi.fn(), setOverEntity: vi.fn() }
}));
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
vi.mock('Controls/ProcessCommand.js', () => ({ default: { add: vi.fn() } }));
vi.mock('UI/CursorManager.js', () => ({ default: { setType: vi.fn(), ACTION: {} } }));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('UI/UIManager.js', () => ({
	default: { addComponent: c => c, showMessageBox: vi.fn(), getComponent: () => mocks.ItemInfo }
}));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/Components/ContextMenu/ContextMenu.js', () => ({
	default: {
		remove: vi.fn(),
		append: vi.fn(),
		addElement: vi.fn(),
		prepare: vi.fn(),
		__loaded: true,
		ui: { find: () => ({ css: vi.fn(), height: () => 0, width: () => 0 }) }
	}
}));
vi.mock('UI/Components/ChatBoxSettings/ChatBoxSettings.js', () => ({
	default: { updateTab: vi.fn(), getTabs: () => [], append: vi.fn(), tabOption: [] }
}));

const ChatBox = (await import('UI/Components/ChatBox/ChatBox.js')).default;
const ChatBoxSettings = (await import('UI/Components/ChatBoxSettings/ChatBoxSettings.js')).default;

ChatBox.magnet = {};
document.body.innerHTML = '';
const host = document.createElement('div');
host.innerHTML = ChatBox.render();
document.body.appendChild(host);
ChatBox._host = host;
ChatBox._shadow = null;
ChatBox.init();

function keyDown(which, key) {
	return ChatBox.onKeyDown({
		which,
		key,
		target: document.body,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
		getModifierState: () => false
	});
}

describe('ChatBox - renaming the active tab', () => {
	// Every key pressed in game used to add one more keyup listener to the
	// active tab's name, so once the focus landed there (Tab), each key ran the
	// tab update as many times as keys had been pressed so far: the page froze.
	it('updates the tab once per key, however many keys came before', () => {
		document.body.focus();
		for (let i = 0; i < 20; i++) {
			keyDown(65, 'a');
		}
		ChatBoxSettings.updateTab.mockClear();

		const tabInput = host.querySelector('.header tr td div.on input');
		tabInput.value = 'Trade';
		tabInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', bubbles: true }));

		expect(ChatBoxSettings.updateTab).toHaveBeenCalledTimes(1);
		expect(ChatBoxSettings.updateTab).toHaveBeenCalledWith(ChatBox.activeTab, 'Trade');
	});

	it('updates a tab added after the chat opened', () => {
		ChatBox.addNewTab('Loot');
		ChatBoxSettings.updateTab.mockClear();

		const tabInput = host.querySelector('.header tr td div.on input');
		tabInput.value = 'Drops';
		tabInput.dispatchEvent(new KeyboardEvent('keyup', { key: 's', bubbles: true }));

		expect(ChatBoxSettings.updateTab).toHaveBeenCalledTimes(1);
		expect(ChatBoxSettings.updateTab).toHaveBeenCalledWith(ChatBox.activeTab, 'Drops');
	});
});
