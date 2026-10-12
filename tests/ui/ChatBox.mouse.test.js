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
const ContextMenu = (await import('UI/Components/ContextMenu/ContextMenu.js')).default;

vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });

ChatBox.magnet = {};
document.body.innerHTML = '';
const host = document.createElement('div');
host.innerHTML = ChatBox.render();
document.body.appendChild(host);
ChatBox._host = host;
ChatBox._shadow = null;
ChatBox.init();

const root = host;
const content = root.querySelector('.content[data-content="0"]');
const nickBox = root.querySelector('.input .username');
const input = root.querySelector('.input-chatbox');

function addLine(text, type) {
	ChatBox.addText(text, type, ChatBox.FILTER.PUBLIC_LOG);
	vi.runAllTimers();
	return content.lastElementChild;
}

describe('ChatBox - mouse on a chat line', () => {
	beforeEach(() => {
		nickBox.value = '';
		input.innerHTML = '';
	});

	describe('double-click', () => {
		it.each([
			['public', ChatBox.TYPE.PUBLIC],
			['party', ChatBox.TYPE.PARTY],
			['guild', ChatBox.TYPE.GUILD]
		])('puts the sender of a %s line into the whisper name box', (_label, type) => {
			const line = addLine('Lady Kaye : hello : there', type);
			line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

			expect(nickBox.value).toBe('Lady Kaye');
		});

		it('saves the sender in the whisper name history', () => {
			const line = addLine('Zeny Bot : wts', ChatBox.TYPE.PUBLIC);
			line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

			const listBtn = root.querySelector('.input .list');
			listBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(ContextMenu.addElement).toHaveBeenCalledWith('Zeny Bot', expect.any(Function));
		});

		it('does nothing on a line with no sender', () => {
			const line = addLine('You got 10 Zeny', ChatBox.TYPE.INFO);
			line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

			expect(nickBox.value).toBe('');
		});

		it('ignores " : " in a whisper line', () => {
			const line = addLine('( From Lady Kaye ) : hi', ChatBox.TYPE.PRIVATE);
			line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

			expect(nickBox.value).toBe('');
		});
	});

	describe('wheel', () => {
		it('scrolls 3 lines per notch', () => {
			let top = 140;
			Object.defineProperty(content, 'scrollTop', {
				configurable: true,
				get: () => top,
				set: v => {
					top = v;
				}
			});
			const lineHeight = 14;

			content.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
			expect(top).toBe(140 + 3 * lineHeight);

			content.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
			expect(top).toBe(140);
		});
	});

	describe('Shift+click on an item link', () => {
		it('inserts the link into the chat input', () => {
			const line = addLine('Lady Kaye : wts <ITEML>000001rI</ITEML>', ChatBox.TYPE.PUBLIC);
			const link = line.querySelector('.item-link');
			link.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

			const inserted = input.querySelector('.item-link');
			expect(inserted).toBeTruthy();
			expect(inserted.getAttribute('data-item')).toBe('<ITEML>000001rI</ITEML>');
			expect(inserted.textContent).toBe('<Red Potion>');
			expect(mocks.ItemInfo.setItem).not.toHaveBeenCalled();
		});

		it('still opens the item description without Shift', () => {
			const line = addLine('Lady Kaye : wts <ITEML>000001rI</ITEML>', ChatBox.TYPE.PUBLIC);
			line.querySelector('.item-link').dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(mocks.ItemInfo.setItem).toHaveBeenCalled();
			expect(input.innerHTML).toBe('');
		});
	});
});
