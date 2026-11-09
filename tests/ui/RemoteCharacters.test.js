/**
 * tests/ui/RemoteCharacters.test.js
 *
 * The hall's list, over a fake BotHall: the search keeps the rows whose account or one character matches, says so
 * when none does, the selection follows the rows kept, and Enter opens the selected one. Typing stays in the field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class MockGUIComponent {
		constructor(name) {
			this.name = name;
			this._host = document.createElement('div');
		}

		getRoot() {
			return this._host;
		}

		draggable() {
			// no drag in the test
		}
	}

	return {
		MockGUIComponent,
		boxes: [],
		remote: { drop: null, attempt: 0, stops: 0 },
		hall: {
			bots: [],
			onChange: null,
			loadSettings: () => ({ relay: 'wss://relay.game.invalid/', relayKey: 'k1', room: 'hall-1', secret: 's' }),
			state: () => 'in',
			waiting: () => false,
			join: () => {
				// already in
			},
			open: null
		}
	};
});

vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Controls/KeyEventHandler.js', () => ({ default: { ENTER: 13, UP: 38, DOWN: 40 } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('DB/Monsters/MonsterTable.js', () => ({ default: { 4: 'Acolyte', 7: 'Knight' } }));
vi.mock('UI/UIManager.js', () => ({
	default: {
		addComponent(component) {
			component.getRoot().innerHTML = component.render();
			component.init();
			return component;
		},
		showMessageBox(text, _type, onOk) {
			const box = { text, ok: onOk, removed: false };
			box.remove = () => {
				box.removed = true;
			};
			mocks.boxes.push(box);
			return box;
		}
	}
}));
vi.mock('Network/RemoteBot.js', () => ({
	default: {
		takeDrop: () => {
			const drop = mocks.remote.drop;
			mocks.remote.drop = null;
			return drop;
		},
		attempt: () => mocks.remote.attempt,
		stopRetry: () => {
			++mocks.remote.stops;
			mocks.remote.attempt = 0;
		}
	}
}));
vi.mock('Network/BotHall.js', () => ({
	default: {
		bots: () => mocks.hall.bots,
		onChange: fn => {
			mocks.hall.onChange = fn;
		},
		loadSettings: () => mocks.hall.loadSettings(),
		state: () => mocks.hall.state(),
		waiting: () => mocks.hall.waiting(),
		join: () => mocks.hall.join(),
		open: id => mocks.hall.open(id)
	}
}));

const { default: RemoteCharacters } = await import('UI/Components/RemoteCharacters/RemoteCharacters.js');
// The instance the component reads, before a test resets the modules
const { default: AutoRetry } = await import('Engine/AutoRetry.js');

const ALICE = {
	id: 'p1',
	account: 'alice_farm',
	chars: [
		{ name: 'Mendel', job: 7, lv: 72 },
		{ name: 'Priestess', job: 4, lv: 40 }
	],
	playing: { name: 'Mendel', job: 7, lv: 72, map: 'pay_fild02' },
	windows: 0
};
const BOB = {
	id: 'p2',
	account: 'bob_kvm',
	chars: [{ name: 'Gardener', job: 4, lv: 12 }],
	playing: null,
	windows: 1
};

function root() {
	return RemoteCharacters.getRoot();
}

function rows() {
	return [...root().querySelectorAll('.bot')].map(node => node.querySelector('.name').textContent);
}

function selected() {
	const node = root().querySelector('.bot.selected');
	return node && node.querySelector('.name').textContent;
}

function search(text) {
	const field = root().querySelector('.search');
	field.value = text;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(which) {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true });
	Object.defineProperty(event, 'which', { value: which });
	root().querySelector('.search').dispatchEvent(event);
	return event;
}

// GUIComponent binds onKeyDown on window: the field's keys bubble up to it
function onWindowKey(event) {
	if (RemoteCharacters.onKeyDown(event) === false) {
		event.preventDefault();
	}
}

beforeEach(() => {
	mocks.hall.bots = [ALICE, BOB];
	mocks.hall.open = vi.fn(
		() =>
			new Promise(() => {
				// the bot never answers
			})
	);
	RemoteCharacters.onRoomOpened = vi.fn();
	document.body.appendChild(root());
	window.removeEventListener('keydown', onWindowKey);
	window.addEventListener('keydown', onWindowKey);
	RemoteCharacters.onAppend();
});

describe('Remote characters search', () => {
	it('lists every account with its characters, the played one marked', () => {
		expect(rows()).toEqual(['alice_farm', 'bob_kvm']);

		const chars = root().querySelectorAll('.bot')[0].querySelectorAll('.char');
		expect([...chars].map(node => node.textContent)).toEqual(['MendelKnight 72', 'PriestessAcolyte 40']);
		expect(chars[0].classList.contains('playing')).toBe(true);
		expect(chars[1].classList.contains('playing')).toBe(false);
		expect(root().querySelector('.match')).toBe(null);
	});

	it('keeps the rows whose account matches, whatever the case', () => {
		search('BOB');

		expect(rows()).toEqual(['bob_kvm']);
		expect(root().querySelector('.match')).toBe(null);
	});

	it('keeps the rows with a matching character and highlights that character', () => {
		search('  priest ');

		expect(rows()).toEqual(['alice_farm']);
		const match = root().querySelectorAll('.char.match');
		expect(match.length).toBe(1);
		expect(match[0].firstChild.textContent).toBe('Priestess');
	});

	it('says so when nothing matches, and shows every row again once the field is empty', () => {
		search('zzz');

		expect(rows()).toEqual([]);
		expect(root().querySelector('.message').textContent).toBe('No account or character matches this search.');
		expect(root().querySelector('.connect').disabled).toBe(true);

		search('');
		expect(rows()).toEqual(['alice_farm', 'bob_kvm']);
	});

	it('still says the hall is being entered, search or not', () => {
		search('zzz');
		mocks.hall.state = () => 'joining';
		mocks.hall.onChange();

		expect(root().querySelector('.message').textContent).toBe('Entering the hall…');
		mocks.hall.state = () => 'in';
	});

	it('moves the selection to the first row kept when the selected one is filtered out', () => {
		expect(selected()).toBe('alice_farm');

		search('gardener');
		expect(selected()).toBe('bob_kvm');

		search('');
		expect(selected()).toBe('bob_kvm');
	});

	it('moves up and down within the rows kept', () => {
		mocks.hall.bots = [ALICE, BOB, { ...BOB, id: 'p3', account: 'carol_farm', chars: [] }];
		mocks.hall.onChange();
		search('farm');
		expect(rows()).toEqual(['alice_farm', 'carol_farm']);

		key(40);
		expect(selected()).toBe('carol_farm');
		key(40);
		expect(selected()).toBe('carol_farm');
		key(38);
		expect(selected()).toBe('alice_farm');
	});

	it('opens the selected row of the search on Enter', () => {
		search('gardener');
		const event = key(13);

		expect(mocks.hall.open).toHaveBeenCalledWith('p2');
		expect(event.defaultPrevented).toBe(true);
	});

	it('keeps typing out of the list keys', () => {
		const list = vi.spyOn(RemoteCharacters, 'onKeyDown');
		const heard = vi.fn();
		window.addEventListener('keydown', heard);

		key(65);
		key(8);
		expect(list).not.toHaveBeenCalled();
		expect(heard).not.toHaveBeenCalled();

		key(13);
		expect(list).toHaveBeenCalledTimes(1);
		window.removeEventListener('keydown', heard);
		list.mockRestore();
	});

	it('still opens a row on double click', () => {
		search('mendel');
		root().querySelector('.bot').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

		expect(mocks.hall.open).toHaveBeenCalledWith('p1');
	});
});

describe('Remote characters opened by the camera page: #control=<account>', () => {
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));
	let Opened;

	beforeEach(async () => {
		history.replaceState(null, '', '/api.html?app=ONLINE#control=bob_kvm');
		vi.resetModules();
		Opened = (await import('UI/Components/RemoteCharacters/RemoteCharacters.js')).default;
		mocks.hall.bots = [ALICE];
		mocks.hall.open = vi.fn(() => Promise.resolve({ room: 'fresh', secret: 'x' }));
		Opened.onRoomOpened = vi.fn();
		Opened.onAppend();
	});

	it('takes the order out of the address bar', () => {
		expect(window.location.hash).toBe('');
		expect(window.location.search).toBe('?app=ONLINE');
	});

	it("opens that account's bot with its control as soon as its hello comes, once", async () => {
		expect(mocks.hall.open).not.toHaveBeenCalled();

		mocks.hall.bots = [ALICE, BOB];
		mocks.hall.onChange();
		await settle();
		expect(mocks.hall.open).toHaveBeenCalledWith('p2');
		expect(Opened.onRoomOpened).toHaveBeenCalledWith(expect.objectContaining({ room: 'fresh', control: true }));

		mocks.hall.onChange();
		await settle();
		expect(mocks.hall.open).toHaveBeenCalledTimes(1);
	});

	it('takes no control for a row opened by hand', async () => {
		Opened.getRoot().querySelector('.bot').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await settle();

		expect(mocks.hall.open).toHaveBeenCalledWith('p1');
		expect(Opened.onRoomOpened).toHaveBeenCalledWith(expect.objectContaining({ control: false }));
	});
});

describe('Remote characters auto-retry', () => {
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	beforeEach(() => {
		AutoRetry.setEnabled(true);
		mocks.boxes.length = 0;
		mocks.remote.stops = 0;
		mocks.hall.open = vi.fn(() => Promise.resolve({ room: 'fresh', secret: 'x' }));
		RemoteCharacters.onRemove();
	});

	function appendAfter(drop) {
		mocks.remote.drop = drop;
		RemoteCharacters.onAppend();
	}

	const LOST = { account: 'alice_farm', character: null, control: true, repick: false, why: '' };
	const OUT = { ...ALICE, playing: null, reconnecting: true };
	const PARKED = { ...ALICE, playing: null, reconnecting: false };

	function state(account) {
		const row = [...root().querySelectorAll('.bot')].find(n => n.querySelector('.name').textContent === account);
		const node = row && row.querySelector('.state');
		return node ? node.textContent : '';
	}

	it('shares its box with the login window', () => {
		RemoteCharacters.onAppend();
		const box = root().querySelector('.autoretry-check');
		expect(box.checked).toBe(true);
		box.checked = false;
		box.dispatchEvent(new Event('change'));
		expect(AutoRetry.isEnabled()).toBe(false);
	});

	it('waits for a bot lost in game until it plays again, then opens it with its control', async () => {
		mocks.hall.bots = [ALICE, BOB]; // the list from before the drop still says it plays
		appendAfter(LOST);
		expect(mocks.hall.open).not.toHaveBeenCalled();

		mocks.hall.bots = [OUT, BOB];
		mocks.hall.onChange();
		expect(state('alice_farm')).toMatch(/Reconnecting to the server/);
		expect(mocks.hall.open).not.toHaveBeenCalled();

		mocks.hall.bots = [ALICE, BOB];
		mocks.hall.onChange();
		await settle();
		expect(mocks.hall.open).toHaveBeenCalledWith('p1');
		expect(RemoteCharacters.onRoomOpened).toHaveBeenCalledWith(
			expect.objectContaining({ account: 'alice_farm', character: 'Mendel', control: true })
		);
	});

	it('lets a parked bot go: nothing brings it back by itself', () => {
		mocks.hall.bots = [ALICE, BOB];
		appendAfter(LOST);
		mocks.hall.bots = [PARKED, BOB];
		mocks.hall.onChange();
		expect(state('alice_farm')).toBe('');
		mocks.hall.bots = [ALICE, BOB];
		mocks.hall.onChange();
		expect(mocks.hall.open).not.toHaveBeenCalled();
	});

	it('keeps waiting for a bot restarted meanwhile, whose first hello is out of the game', async () => {
		mocks.hall.bots = [ALICE];
		appendAfter(LOST);
		mocks.hall.bots = [{ ...PARKED, id: 'p9' }];
		mocks.hall.onChange();
		expect(state('alice_farm')).toMatch(/Waiting for it/);
		mocks.hall.bots = [{ ...ALICE, id: 'p9' }];
		mocks.hall.onChange();
		await settle();
		expect(mocks.hall.open).toHaveBeenCalledWith('p9');
	});

	it('does not open a bot that reconnects by itself, and opens it once it plays', async () => {
		mocks.hall.bots = [OUT, BOB];
		RemoteCharacters.onAppend();
		root().querySelector('.connect').click();
		expect(mocks.hall.open).not.toHaveBeenCalled();
		expect(state('alice_farm')).toMatch(/opened once it plays again/);

		mocks.hall.bots = [ALICE, BOB];
		mocks.hall.onChange();
		await settle();
		expect(mocks.hall.open).toHaveBeenCalledWith('p1');
	});

	it('stops waiting on another bot picked, Normal login, or the box unticked', () => {
		const lost = () => {
			mocks.hall.bots = [OUT, BOB];
			appendAfter(LOST);
			mocks.hall.onChange();
		};
		const comesBack = () => {
			mocks.hall.bots = [ALICE, BOB];
			mocks.hall.onChange();
		};
		RemoteCharacters.onLoginRequest = vi.fn();

		lost();
		root().querySelectorAll('.bot')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		comesBack();
		lost();
		root().querySelector('.login').click();
		comesBack();
		lost();
		const box = root().querySelector('.autoretry-check');
		box.checked = false;
		box.dispatchEvent(new Event('change'));
		comesBack();

		expect(mocks.hall.open).not.toHaveBeenCalled();
	});

	it('picks the same character again after the box of a login that failed for a while', async () => {
		vi.useFakeTimers();
		try {
			mocks.hall.bots = [PARKED, BOB];
			mocks.remote.attempt = 2;
			appendAfter({ account: 'alice_farm', character: 'Priestess', control: false, repick: true, why: 'x' });
			expect(mocks.boxes.map(b => b.text)).toEqual(['Remote client: x.']);
			expect(state('alice_farm')).toBe('Retrying… (attempt 2)');
			expect(mocks.hall.open).not.toHaveBeenCalled();

			vi.advanceTimersByTime(AutoRetry.MIN_GAP);
			expect(mocks.boxes[0].removed).toBe(true);
			expect(mocks.hall.open).toHaveBeenCalledWith('p1');
			await vi.runAllTimersAsync();
			expect(RemoteCharacters.onRoomOpened).toHaveBeenCalledWith(
				expect.objectContaining({ character: 'Priestess', control: false })
			);
			expect(mocks.remote.stops).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('OK on the box of the failed login stops the run', () => {
		vi.useFakeTimers();
		try {
			mocks.hall.bots = [PARKED, BOB];
			appendAfter({ account: 'alice_farm', character: 'Priestess', control: false, repick: true, why: 'x' });
			mocks.boxes[0].ok();
			vi.advanceTimersByTime(AutoRetry.MIN_GAP);
			expect(mocks.hall.open).not.toHaveBeenCalled();
			expect(mocks.remote.stops).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
