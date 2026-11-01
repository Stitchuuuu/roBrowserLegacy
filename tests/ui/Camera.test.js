/**
 * tests/ui/Camera.test.js
 *
 * The camera page over a fake BotHall: each slot's state (empty, offline, busy, watching), the bot list, the room
 * asked once the tile's game window is ready and handed to it by message, « Scene only » on the tile's body, Control,
 * and what is kept for the next visit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bots: [],
	state: 'in',
	onChange: null,
	open: null,
	join: null,
	settings: { relay: 'wss://relay.game.invalid/', relayKey: 'k1', room: 'hall-1', secret: 'hall-secret' }
}));

vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn() } }));
vi.mock('DB/Monsters/MonsterTable.js', () => ({ default: { 4: 'Acolyte', 7: 'Knight' } }));
vi.mock('Network/BotHall.js', () => ({
	default: {
		bots: () => mocks.bots,
		state: () => mocks.state,
		onChange: fn => {
			mocks.onChange = fn;
		},
		loadSettings: () => mocks.settings,
		join: settings => mocks.join(settings),
		open: id => mocks.open(id)
	}
}));

const ALICE = {
	id: 'p1',
	account: 'alice_farm',
	chars: [{ name: 'Mendel', job: 7, lv: 72 }],
	playing: { name: 'Mendel', job: 7, lv: 72, map: 'pay_fild02' },
	windows: 0
};
const BOB = {
	id: 'p2',
	account: 'bob_kvm',
	chars: [{ name: 'Gardener', job: 4, lv: 12 }],
	playing: { name: 'Gardener', job: 4, lv: 12, map: 'prontera' },
	windows: 4
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let Camera;

async function start() {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	vi.resetModules();
	Camera = (await import('UI/Components/Camera/Camera.js')).default;
	Camera.init();
}

const tiles = () => [...document.querySelectorAll('#Camera .tile')];
const shown = () => tiles().filter(node => !node.classList.contains('hidden'));
const message = i => {
	const msg = tiles()[i].querySelector('.msg');
	return msg.style.display === 'none' ? '' : msg.querySelector('.big').textContent;
};
const frame = i => tiles()[i].querySelector('iframe');
const mousedown = node => node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const hall = bots => {
	mocks.bots = bots;
	mocks.onChange();
};

/** Pick a bot in a slot through its list */
function pick(i, account) {
	mousedown(tiles()[i].querySelector('.select'));
	const row = [...tiles()[i].querySelectorAll('.drop .row')].find(r => r.querySelector('.name').textContent === account);
	mousedown(row);
}

/** The tile's game window loads (config), reaches its login screen (ready), and the bot answers (room) */
async function answer(i) {
	const node = frame(i);
	const post = vi.spyOn(node.contentWindow, 'postMessage');
	// jsdom loads no page in a frame: the game page's body
	const doc = node.contentDocument;
	if (!doc.body) {
		(doc.documentElement || doc.appendChild(doc.createElement('html'))).appendChild(doc.createElement('body'));
	}
	node.dispatchEvent(new Event('load'));
	ready(node);
	await settle();
	return { node, post };
}

/** A game window at its login screen tells the page */
function ready(node, origin = window.location.origin) {
	window.dispatchEvent(
		new MessageEvent('message', { data: { t: 'camera-ready' }, origin, source: node.contentWindow })
	);
}

beforeEach(() => {
	localStorage.clear();
	mocks.bots = [ALICE, BOB];
	mocks.state = 'in';
	mocks.join = vi.fn();
	mocks.open = vi.fn(id => Promise.resolve({ room: 'fresh-' + id, secret: 'room-secret' }));
		window.ROConfig = {
		application: 8,
		servers: [{ display: 'A' }, { display: 'B' }],
		skipServerList: false,
		autoLogin: ['me', 'pw']
	};
});

describe('camera page', () => {
	it('joins the hall once and shows 8 empty tiles, Control greyed', async () => {
		await start();

		expect(mocks.join).toHaveBeenCalledWith(mocks.settings);
		expect(shown()).toHaveLength(8);
		expect(message(0)).toBe('No bot on this tile');
		expect(tiles()[0].querySelector('.control').disabled).toBe(true);
		expect(document.querySelector('#Camera .head .count').textContent).toBe('2 bots in the hall');
	});

	it('lists the hall under a select, a full bot greyed and not pickable', async () => {
		await start();
		mousedown(tiles()[2].querySelector('.select'));
		const rows = [...tiles()[2].querySelectorAll('.drop .row')];

		expect(rows.map(r => r.querySelector('.name').textContent)).toEqual(['alice_farm', 'bob_kvm']);
		expect(rows[0].querySelector('.char').textContent).toBe('MendelKnight 72');
		expect(rows[1].classList.contains('busy')).toBe(true);
		expect(rows[1].querySelector('.map').textContent).toBe('full · 4 windows');

		mousedown(rows[1]);
		expect(mocks.open).not.toHaveBeenCalled();
		expect(message(2)).toBe('No bot on this tile');
	});

	it('watches a picked bot, scene only first, the room asked once its game window is ready, by message only', async () => {
		await start();
		pick(1, 'alice_farm');
		expect(frame(1).getAttribute('src')).toMatch(/api\.html#camera$/);
		expect(mocks.open).not.toHaveBeenCalled(); // no room waits for a window still loading

		const { node, post } = await answer(1);
		expect(mocks.open).toHaveBeenCalledWith('p1');
		const [[config, origin], [room, roomOrigin]] = post.mock.calls;
		expect(origin).toBe(window.location.origin);
		expect(config).toMatchObject({
			application: 1,
			skipServerList: true,
			skipIntro: true,
			servers: [{ display: 'A' }]
		});
		expect(JSON.stringify(config)).not.toContain('secret');
		expect(config).not.toHaveProperty('autoLogin'); // a tile logs in through its room only
		expect(roomOrigin).toBe(window.location.origin);
		expect(room).toEqual({
			t: 'camera-room',
			room: {
				relay: 'wss://relay.game.invalid/',
				relayKey: 'k1',
				room: 'fresh-p1',
				secret: 'room-secret',
				character: 'Mendel'
			}
		});
		expect(node.getAttribute('src')).not.toContain('secret');
		expect(node.contentDocument.body.classList.contains('scene-only')).toBe(true);
		expect(tiles()[1].querySelector('.toggle').classList.contains('on')).toBe(true);
		expect(tiles()[1].querySelector('.msg').style.display).toBe('none');
	});

	it('takes a ready message from its own game window and this origin only', async () => {
		await start();
		pick(0, 'alice_farm');
		const node = frame(0);
		node.dispatchEvent(new Event('load'));

		ready(node, 'https://other.example');
		window.dispatchEvent(new MessageEvent('message', { data: { t: 'camera-ready' }, origin: window.location.origin }));
		await settle();
		expect(mocks.open).not.toHaveBeenCalled();
	});

	it('turns scene only off and on in the tile without reloading it', async () => {
		await start();
		pick(0, 'alice_farm');
		const { node } = await answer(0);

		tiles()[0].querySelector('.toggle').click();
		expect(node.contentDocument.body.classList.contains('scene-only')).toBe(false);
		expect(frame(0)).toBe(node);
		tiles()[0].querySelector('.toggle').click();
		expect(node.contentDocument.body.classList.contains('scene-only')).toBe(true);
	});

	it('Control opens the bot with its control in a new tab, while the tile keeps watching', async () => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		await start();
		pick(0, 'alice_farm');
		const { node } = await answer(0);

		const control = tiles()[0].querySelector('.control');
		expect(control.disabled).toBe(false);
		control.click();
		expect(open).toHaveBeenCalledWith(`${window.location.pathname}?app=ONLINE#control=alice_farm`, '_blank');
		expect(frame(0)).toBe(node);
		open.mockRestore();
	});

	it('says a bot is offline, keeps the pick, and watches again once it is back', async () => {
		await start();
		pick(0, 'alice_farm');
		await answer(0);

		hall([BOB]);
		expect(frame(0)).toBe(null);
		expect(message(0)).toBe('Mendel is offline');
		expect(tiles()[0].querySelector('.control').disabled).toBe(true);
		expect(tiles()[0].querySelector('.select b').textContent).toBe('Mendel');

		hall([BOB, { ...ALICE, playing: null }]); // in the hall, not in game: still offline
		expect(message(0)).toBe('Mendel is offline');
		expect(mocks.open).toHaveBeenCalledTimes(1);

		hall([BOB, { ...ALICE, id: 'p9' }]);
		await answer(0);
		expect(mocks.open).toHaveBeenLastCalledWith('p9');
		expect(message(0)).toBe('');
	});

	it('says a bot is busy when it has its windows, or refuses one more', async () => {
		localStorage.setItem('cameraTiles', JSON.stringify({ count: 4, slots: [{ account: 'bob_kvm', name: 'Gardener', scene: true }] }));
		await start();
		expect(mocks.open).not.toHaveBeenCalled();
		expect(message(0)).toBe('Gardener already has 4 windows open');

		mocks.open = vi.fn(() => Promise.reject(Object.assign(new Error('busy'), { code: 'busy' })));
		hall([ALICE, { ...BOB, windows: 3 }]);
		await answer(0);
		expect(mocks.open).toHaveBeenCalledWith('p2');
		expect(message(0)).toBe('Gardener already has 4 windows open');
		expect(tiles()[0].querySelector('.control').disabled).toBe(true);

		// Asked again on the next change, through the same game window
		const node = frame(0);
		mocks.open = vi.fn(id => Promise.resolve({ room: 'fresh-' + id, secret: 'room-secret' }));
		hall([ALICE, { ...BOB, windows: 2 }]);
		await settle();
		expect(mocks.open).toHaveBeenCalledWith('p2');
		expect(frame(0)).toBe(node);
		expect(message(0)).toBe('');
	});

	it('keeps the tile count and each slot pick and scene only for the next visit', async () => {
		await start();
		mousedown(document.querySelector('#Camera .head .count-4'));
		document.querySelector('#Camera .head .count-4').click();
		pick(3, 'alice_farm');
		await answer(3);
		tiles()[3].querySelector('.toggle').click();

		expect(JSON.parse(localStorage.getItem('cameraTiles'))).toEqual({
			count: 4,
			slots: [null, null, null, { account: 'alice_farm', name: 'Mendel', scene: false }, null, null, null, null]
		});

		await start();
		expect(shown()).toHaveLength(4);
		expect(tiles()[3].querySelector('.toggle').classList.contains('on')).toBe(false);
		expect(frame(3)).not.toBe(null);
	});

	it('lets go of the game window of a tile the count hides', async () => {
		await start();
		pick(6, 'alice_farm');
		await answer(6);

		document.querySelector('#Camera .head .count-6').click();
		expect(frame(6)).toBe(null);
		expect(tiles()[6].classList.contains('hidden')).toBe(true);
	});

	it('loads one game window at a time: the next once the last one is at its login screen', async () => {
		await start();
		pick(0, 'alice_farm');
		pick(1, 'alice_farm');
		expect(frame(0)).not.toBe(null);
		expect(frame(1)).toBe(null);

		await answer(0);
		expect(frame(1)).not.toBe(null);
	});

	it('lets the next game window load when one never reaches its login screen, then starts it again', async () => {
		vi.useFakeTimers();
		await start();
		pick(0, 'alice_farm');
		pick(1, 'alice_farm');
		const stuck = frame(0);

		vi.advanceTimersByTime(60000);
		expect(stuck.isConnected).toBe(false);
		expect(frame(0)).toBe(null);
		expect(frame(1)).not.toBe(null);

		frame(1).dispatchEvent(new Event('load'));
		ready(frame(1));
		vi.advanceTimersByTime(60000);
		expect(frame(0)).not.toBe(null);
		vi.useRealTimers();
	});

	it('asks again for a room the bot did not give, after a while', async () => {
		vi.useFakeTimers();
		mocks.open = vi.fn(() => Promise.reject(Object.assign(new Error('no answer'), { code: 'no-answer' })));
		await start();
		pick(0, 'alice_farm');
		frame(0).dispatchEvent(new Event('load'));
		ready(frame(0));
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.open).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(10000);
		expect(mocks.open).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('drops an answer for a pick replaced meanwhile', async () => {
		let resolve;
		mocks.open = vi.fn(() => new Promise(r => (resolve = r)));
		await start();
		pick(0, 'alice_farm');
		await answer(0);
		const first = resolve;
		pick(0, 'alice_farm');
		const { post } = await answer(0);
		first({ room: 'old', secret: 'x' });
		await settle();
		expect(post.mock.calls.map(([m]) => m.t)).toEqual([undefined]);

		resolve({ room: 'new', secret: 'y' });
		await settle();
		expect(post.mock.calls[1][0].room.room).toBe('new');
		expect(tiles()[0].querySelectorAll('iframe')).toHaveLength(1);
	});
});
