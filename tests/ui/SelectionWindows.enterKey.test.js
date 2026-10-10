import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class MockGUIComponent {
		constructor(name) {
			this.name = name;
			this._host = document.createElement('div');
			this.remove = vi.fn();
		}

		getRoot() {
			return this._host;
		}

		draggable() {}
	}

	const itemInfo = { identifiedResourceName: 'apple', identifiedDisplayName: 'Apple', processitemlist: '' };

	return { MockGUIComponent, itemInfo };
});

vi.mock('DB/DBManager.js', () => ({
	default: {
		INTERFACE_PATH: '',
		getItemInfo: () => mocks.itemInfo,
		getItemName: () => 'Apple',
		getMessage: (id, defaultText) => (defaultText !== undefined ? defaultText : `NO MSG ${id}`)
	}
}));
vi.mock('DB/Skills/SkillInfo.js', () => ({ default: {} }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('UI/Components/Inventory/Inventory.js', () => {
	const inventory = { getItemByIndex: vi.fn(), addItem: vi.fn() };
	inventory.getUI = () => inventory;
	return { default: inventory };
});
vi.mock('UI/Elements/Elements.js', () => ({}));

const ItemSelection = (await import('UI/Components/ItemSelection/ItemSelection.js')).default;
const MakeItemSelection = (await import('UI/Components/MakeItemSelection/MakeItemSelection.js')).default;
const KEYS = (await import('Controls/KeyEventHandler.js')).default;
const Inventory = (await import('UI/Components/Inventory/Inventory.js')).default;

// jsdom has no layout, so no scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function keyEvent(which) {
	return {
		which,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn()
	};
}

function mount(component) {
	component._host.innerHTML = component.render();
	component.remove.mockClear();
	component.init();
}

describe('ItemSelection — Enter', () => {
	beforeEach(() => {
		mount(ItemSelection);
		ItemSelection.onIndexSelected = vi.fn();
	});

	it('validates the selected entry, like the OK button', () => {
		ItemSelection.index = 7;
		const event = keyEvent(KEYS.ENTER);

		expect(ItemSelection.onKeyDown(event)).toBe(false);
		expect(ItemSelection.onIndexSelected).toHaveBeenCalledWith(7);
		expect(ItemSelection.remove).toHaveBeenCalled();
		expect(event.stopImmediatePropagation).toHaveBeenCalled();
	});

	it('lets other keys through', () => {
		const event = keyEvent(KEYS.A);

		expect(ItemSelection.onKeyDown(event)).toBe(true);
		expect(ItemSelection.onIndexSelected).not.toHaveBeenCalled();
		expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
	});
});

describe('ItemSelection — Up / Down', () => {
	beforeEach(() => {
		mount(ItemSelection);
		Inventory.getItemByIndex.mockImplementation(index => ({ index, ITID: 501, IsIdentified: true }));
		ItemSelection.setList([3, 5, 9]);
	});

	it('moves the selection to the next and previous rows', () => {
		const event = keyEvent(KEYS.DOWN);

		expect(ItemSelection.onKeyDown(event)).toBe(false);
		expect(ItemSelection.index).toBe(5);
		expect(event.stopImmediatePropagation).toHaveBeenCalled();

		ItemSelection.onKeyDown(keyEvent(KEYS.DOWN));
		expect(ItemSelection.index).toBe(9);

		ItemSelection.onKeyDown(keyEvent(KEYS.UP));
		expect(ItemSelection.index).toBe(5);
	});

	it('stays on the first and last rows', () => {
		ItemSelection.onKeyDown(keyEvent(KEYS.UP));
		expect(ItemSelection.index).toBe(3);

		ItemSelection.setIndex(9);
		ItemSelection.onKeyDown(keyEvent(KEYS.DOWN));
		expect(ItemSelection.index).toBe(9);
	});
});

describe('MakeItemSelection — Enter', () => {
	beforeEach(() => {
		mount(MakeItemSelection);
		MakeItemSelection.onIndexSelected = vi.fn();
	});

	it('validates the selected item when it needs no materials', () => {
		mocks.itemInfo.processitemlist = '';
		MakeItemSelection.setList([{ ITID: 501 }]);
		const event = keyEvent(KEYS.ENTER);

		expect(MakeItemSelection.onKeyDown(event)).toBe(false);
		expect(MakeItemSelection.onIndexSelected).toHaveBeenCalledWith(501, [], 0);
		expect(MakeItemSelection.remove).toHaveBeenCalled();
		expect(event.stopImmediatePropagation).toHaveBeenCalled();
	});

	it('moves to the materials step first, as the OK button does', () => {
		mocks.itemInfo.processitemlist = 'Iron';
		MakeItemSelection.setList([{ ITID: 998 }]);

		MakeItemSelection.onKeyDown(keyEvent(KEYS.ENTER));
		expect(MakeItemSelection.onIndexSelected).not.toHaveBeenCalled();
		expect(MakeItemSelection.getRoot().querySelector('.materials').style.display).toBe('block');

		MakeItemSelection.onKeyDown(keyEvent(KEYS.ENTER));
		expect(MakeItemSelection.onIndexSelected).toHaveBeenCalledWith(998, [], 0);
	});

	it('still closes on Escape', () => {
		const event = keyEvent(KEYS.ESCAPE);

		MakeItemSelection.onKeyDown(event);
		expect(MakeItemSelection.remove).toHaveBeenCalled();
		expect(MakeItemSelection.onIndexSelected).not.toHaveBeenCalled();
	});
});

describe('MakeItemSelection — Up / Down', () => {
	beforeEach(() => {
		mount(MakeItemSelection);
		MakeItemSelection.onIndexSelected = vi.fn();
	});

	it('moves the selection to the next and previous rows', () => {
		MakeItemSelection.setList([{ ITID: 501 }, { ITID: 502 }]);
		const event = keyEvent(KEYS.DOWN);

		expect(MakeItemSelection.onKeyDown(event)).toBe(false);
		expect(MakeItemSelection.index).toBe(502);
		expect(event.stopImmediatePropagation).toHaveBeenCalled();

		MakeItemSelection.onKeyDown(keyEvent(KEYS.UP));
		expect(MakeItemSelection.index).toBe(501);
	});

	it('leaves the chosen item alone on the materials step', () => {
		mocks.itemInfo.processitemlist = 'Iron';
		MakeItemSelection.setList([{ ITID: 998 }, { ITID: 999 }]);
		MakeItemSelection.onKeyDown(keyEvent(KEYS.ENTER));

		MakeItemSelection.onKeyDown(keyEvent(KEYS.DOWN));
		expect(MakeItemSelection.index).toBe(998);
	});
});
