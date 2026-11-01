/**
 * UI/Components/Camera/Camera.js
 *
 * The camera page: a grid of 4, 6 or 8 tiles, each one a game window watching a bot of the hall
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Client from 'Core/Client.js';
import MonsterTable from 'DB/Monsters/MonsterTable.js';
import BotHall from 'Network/BotHall.js';
import cssText from './Camera.css?raw';

/**
 * localStorage key of the tile count and of each slot's pick
 * @const {string}
 */
const STORAGE_KEY = 'cameraTiles';

/**
 * Columns of the two rows, by tile count
 * @const {object}
 */
const COLUMNS = { 4: 2, 6: 3, 8: 4 };

/**
 * Slots kept, whatever the count shown
 * @const {number}
 */
const SLOTS = 8;

/**
 * Windows a bot holds at most (the bot refuses beyond)
 * @const {number}
 */
const MAX_WINDOWS = 4;

/**
 * Time a game window has to reach its login screen before it is started again (ms)
 * @const {number}
 */
const BOOT_MS = 60000;

/**
 * Time before a room the bot did not give is asked again (ms); a refusal for its windows waits for the hall
 * @const {number}
 */
const RETRY_MS = 10000;

/**
 * Skin bitmaps of the client, under the interface path, as CSS variables
 * @const {object}
 */
const SKIN = {
	'--skin-btnbar-left': 'basic_interface/btnbar_left2.bmp',
	'--skin-btnbar-mid': 'basic_interface/btnbar_mid2.bmp',
	'--skin-btnbar-right': 'basic_interface/btnbar_right2.bmp',
	'--skin-titlebar': 'basic_interface/titlebar_mid.bmp',
	'--skin-combo': 'basic_interface/combo_btn_a.bmp',
	'--skin-btn': 'navigation_interface3/btn_normal.bmp',
	'--skin-btn-press': 'navigation_interface3/btn_press.bmp',
	'--skin-checkbox-off': 'checkbox_0.bmp',
	'--skin-checkbox-on': 'checkbox_1.bmp'
};

/**
 * DB.INTERFACE_PATH, without the whole DB on a page with no game
 * @const {string}
 */
const INTERFACE_PATH = 'data/texture/\xc0\xaf\xc0\xfa\xc0\xce\xc5\xcd\xc6\xe4\xc0\xcc\xbd\xba/';

/**
 * Monochrome icons of the tile messages
 * @const {object}
 */
const ICON = {
	empty: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2" y="5" width="11" height="10" rx="1.5"/><path d="M13 9l5-3v8l-5-3"/></svg>',
	offline:
		'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 2.5v7"/><path d="M5.5 5.2a6.5 6.5 0 1 0 9 0"/></svg>',
	busy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="11" height="8" rx="1"/><rect x="7" y="9" width="11" height="8" rx="1"/></svg>'
};

/**
 * What a tile says when it does not watch, by state
 * @const {object}
 */
const MESSAGES = {
	empty: () => ['No bot on this tile', 'Pick one in the list above.'],
	offline: name => [`${name} is offline`, 'The tile watches again as soon as it is back.'],
	busy: name => [`${name} already has ${MAX_WINDOWS} windows open`, 'Close one of them to watch it here.']
};

const Camera = {};

/**
 * @var {HTMLElement} _root
 */
let _root = null;

/**
 * @var {number} _count - tiles shown
 */
let _count = 8;

/**
 * @var {Array<?{account: string, name: string, scene: boolean}>} _slots - each slot's pick, kept
 */
let _slots = [];

/**
 * @var {Array<object>} _tiles - each slot's game window: bot, the peer id it is for; frame; ready, at its login
 *   screen; opening, the room asked (0: none, an answer for an older one is dropped); watching, the room given;
 *   failure, why the bot gave none; retry, no load before this time (one that never got ready lets the others
 *   go first); node, the tile
 */
let _tiles = [];

/**
 * @var {number} _drop - the slot whose bot list is open, -1 for none
 */
let _drop = -1;

/**
 * @var {number} _opens - counts the opens asked
 */
let _opens = 0;

/**
 * Build the page and join the hall
 */
Camera.init = function init() {
	const style = document.createElement('style');
	const settings = BotHall.loadSettings();

	style.textContent = cssText;
	document.head.appendChild(style);
	load();

	_root = element('div');
	_root.id = 'Camera';
	_root.appendChild(head());
	_root.appendChild(element('div', 'grid'));
	document.body.appendChild(_root);

	_tiles = [];
	for (let i = 0; i < SLOTS; ++i) {
		_tiles.push({
			bot: null,
			frame: null,
			ready: false,
			opening: 0,
			watching: false,
			failure: null,
			retry: 0,
			node: tileNode(i)
		});
	}

	document.addEventListener('mousedown', event => {
		if (_drop >= 0 && !event.target.closest('.drop, .select')) {
			closeDrop();
		}
	});
	window.addEventListener('message', onReady);
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			closeDrop();
		}
	});

	if (!settings) {
		const message = element(
			'div',
			'message',
			'Set your hall first: Remote characters, Settings, on the login screen of the game.'
		);
		_root.querySelector('.grid').appendChild(message);
		return;
	}

	for (let i = 0; i < SLOTS; ++i) {
		_root.querySelector('.grid').appendChild(_tiles[i].node);
	}
	BotHall.onChange(update);
	BotHall.join(settings);
	update();
};

/**
 * The skin bitmaps, once the client can read the GRF
 */
Camera.skin = function skin() {
	for (const name in SKIN) {
		Client.loadFile(INTERFACE_PATH + SKIN[name], uri => {
			_root.style.setProperty(name, `url(${uri})`);
		});
	}
};

/**
 * Count and picks of the last visit
 */
function load() {
	let stored = null;

	try {
		stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
	} catch (_e) {
		// Nothing kept
	}
	_count = stored && COLUMNS[stored.count] ? stored.count : 8;
	_slots = [];
	for (let i = 0; i < SLOTS; ++i) {
		const slot = stored && Array.isArray(stored.slots) ? stored.slots[i] : null;
		_slots.push(slot && typeof slot.account === 'string' ? slot : null);
	}
}

function save() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: _count, slots: _slots }));
	} catch (_e) {
		// Private mode: the next visit starts empty
	}
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @return {HTMLElement}
 */
function element(tag, className, text) {
	const node = document.createElement(tag);

	if (className) {
		node.className = className;
	}
	if (text) {
		node.textContent = text;
	}
	return node;
}

/**
 * @return {HTMLElement} « Camera », the tile count, the hall
 */
function head() {
	const node = element('div', 'head');

	node.appendChild(element('span', 'title', 'Camera'));
	node.appendChild(element('span', '', 'Tiles:'));
	for (const n in COLUMNS) {
		const button = element('button', 'btn count-' + n, n);
		button.addEventListener('click', () => {
			_count = Number(n);
			save();
			closeDrop();
			update();
		});
		node.appendChild(button);
	}
	node.appendChild(element('span', 'count'));
	return node;
}

/**
 * @param {number} i - slot
 * @return {HTMLElement} the bar: bot list, « Scene only », Control
 */
function tileNode(i) {
	const node = element('div', 'tile');
	const bar = element('div', 'bar');
	const select = element('div', 'select');
	const toggle = element('span', 'toggle');
	const control = element('button', 'btn control', 'Control');

	toggle.appendChild(element('i'));
	toggle.appendChild(document.createTextNode('Scene only'));
	select.addEventListener('mousedown', () => (_drop === i ? closeDrop() : openDrop(i)));
	toggle.addEventListener('click', () => {
		if (_slots[i]) {
			_slots[i].scene = !_slots[i].scene;
			save();
			draw(i);
		}
	});
	control.addEventListener('click', () => {
		window.open(controlUrl(_slots[i].account), '_blank');
	});

	bar.appendChild(select);
	bar.appendChild(toggle);
	bar.appendChild(control);
	node.appendChild(bar);
	node.appendChild(element('div', 'msg'));
	return node;
}

/**
 * The page that takes the bot's control: the hall list of a game page opens it as soon as it is listed
 *
 * @param {string} account
 * @return {string}
 * @see docs/reference/network/remote-bot.md
 */
function controlUrl(account) {
	return `${window.top.location.pathname}?app=ONLINE#control=${encodeURIComponent(account)}`;
}

/**
 * @param {string} account
 * @return {?object} its hall row
 */
function find(account) {
	return BotHall.bots().find(bot => bot.account === account) || null;
}

/**
 * @param {number} i - slot
 * @return {string} empty, offline, busy, opening or watching
 */
function stateOf(i) {
	const slot = _slots[i];
	const tile = _tiles[i];
	const bot = slot && find(slot.account);

	if (!slot) {
		return 'empty';
	}
	if (tile.watching) {
		return 'watching';
	}
	if (!bot || !bot.playing) {
		return 'offline';
	}
	if (tile.failure === 'busy' || (bot.windows >= MAX_WINDOWS && !tile.opening)) {
		return 'busy';
	}
	return 'opening';
}

/**
 * The hall changed: open what can be watched, let go of what cannot, draw
 */
function update() {
	const state = BotHall.state();
	const count = BotHall.bots().length;

	_root.querySelector('.grid').style.gridTemplateColumns = `repeat(${COLUMNS[_count]}, 1fr)`;
	for (const n in COLUMNS) {
		_root.querySelector('.count-' + n).classList.toggle('on', Number(n) === _count);
	}
	_root.querySelector('.head .count').textContent =
		state === 'in'
			? `${count} bot${count === 1 ? '' : 's'} in the hall`
			: state === 'joining'
				? 'Entering the hall…'
				: `Cannot reach the hall (${state})`;

	for (let i = 0; i < SLOTS; ++i) {
		sync(i);
		draw(i);
	}
	if (_drop >= 0) {
		openDrop(_drop);
	}
}

/**
 * A game window for a bot that plays, a room once that window is at its login screen
 *
 * @param {number} i - slot
 */
function sync(i) {
	const slot = _slots[i];
	const tile = _tiles[i];
	const bot = slot && i < _count ? find(slot.account) : null;
	const live = bot && bot.playing ? bot : null;

	if (tile.frame && (!live || live.id !== tile.bot)) {
		leave(i);
	}
	if (!live || live.windows >= MAX_WINDOWS || tile.watching || tile.opening) {
		return;
	}
	if (!tile.frame) {
		if (Date.now() < tile.retry) {
			return;
		}
		// One game window loads at a time: N engines at once starve the page of requests and of its thread
		if (!_tiles.some(other => other.frame && !other.ready)) {
			start(i, live.id);
		}
	} else if (tile.ready) {
		open(i);
	}
}

/**
 * A game window in the tile, given the page's config by message
 *
 * @param {number} i - slot
 * @param {string} id - peer id of the bot it is for
 * @see docs/reference/network/remote-bot.md
 */
function start(i, id) {
	const tile = _tiles[i];
	const frame = document.createElement('iframe');

	frame.src = new URL('api.html#camera', window.location.href).href;
	frame.addEventListener('load', () => {
		frame.contentWindow.postMessage(tileConfig(), window.location.origin);
		scene(i);
	});
	tile.bot = id;
	tile.frame = frame;
	tile.node.appendChild(frame);
	setTimeout(() => {
		if (tile.frame === frame && !tile.ready) {
			leave(i);
			tile.retry = Date.now() + BOOT_MS;
			setTimeout(update, BOOT_MS);
			update();
		}
	}, BOOT_MS);
}

/**
 * The page's own config for a game window: the first server without its list, no intro
 *
 * @return {object}
 */
function tileConfig() {
	const config = JSON.parse(JSON.stringify(window.ROConfig || {}));

	if (Array.isArray(config.servers)) {
		config.servers = config.servers.slice(0, 1);
	}
	// A tile logs in through its room only
	delete config.autoLogin;
	return Object.assign(config, { application: 1, skipServerList: true, skipIntro: true });
}

/**
 * A tile's game window is at its login screen (first load, or back after a failure): it takes a room now
 *
 * @param {MessageEvent} event
 */
function onReady(event) {
	const i = _tiles.findIndex(tile => tile.frame && tile.frame.contentWindow === event.source);

	if (i < 0 || event.origin !== window.location.origin || !event.data || event.data.t !== 'camera-ready') {
		return;
	}
	_tiles[i].ready = true;
	_tiles[i].watching = false;
	// This one, and the next one to load
	update();
}

/**
 * Ask the bot for a room of this tile's own, handed to its game window by message (never by its address)
 *
 * @param {number} i - slot
 * @see docs/reference/network/remote-bot.md
 */
function open(i) {
	const tile = _tiles[i];
	const opening = ++_opens;

	tile.opening = opening;
	tile.failure = null;
	BotHall.open(tile.bot).then(
		answer => {
			const bot = BotHall.bots().find(b => b.id === tile.bot);

			if (tile.opening !== opening) {
				return;
			}
			tile.opening = 0;
			tile.watching = true;
			if (bot && bot.playing) {
				_slots[i].name = bot.playing.name;
				save();
			}
			tile.frame.contentWindow.postMessage(
				{
					t: 'camera-room',
					room: {
						...BotHall.loadSettings(),
						room: answer.room,
						secret: answer.secret,
						character: bot && bot.playing ? bot.playing.name : null
					}
				},
				window.location.origin
			);
			draw(i);
		},
		err => {
			if (tile.opening !== opening) {
				return;
			}
			// Asked again on the next change of the hall, or after a while when the bot did not answer
			tile.opening = 0;
			tile.failure = err.code || 'error';
			if (tile.failure !== 'busy') {
				setTimeout(update, RETRY_MS);
			}
			draw(i);
		}
	);
}

/**
 * Close the tile's game window: the bot lets go of its room
 *
 * @param {number} i - slot
 */
function leave(i) {
	const tile = _tiles[i];

	if (tile.frame) {
		tile.frame.remove();
	}
	tile.frame = null;
	tile.bot = null;
	tile.ready = false;
	tile.opening = 0;
	tile.watching = false;
	tile.failure = null;
	tile.retry = 0;
}

/**
 * « Scene only » on the tile's game window
 *
 * @param {number} i - slot
 */
function scene(i) {
	const frame = _tiles[i].frame;
	const body = frame && frame.contentDocument && frame.contentDocument.body;

	if (body) {
		body.classList.toggle('scene-only', !!(_slots[i] && _slots[i].scene));
	}
}

/**
 * @param {number} i - slot
 */
function draw(i) {
	const slot = _slots[i];
	const node = _tiles[i].node;
	const select = node.querySelector('.select');
	const msg = node.querySelector('.msg');
	const state = stateOf(i);
	const text = MESSAGES[state];

	node.classList.toggle('hidden', i >= _count);
	select.textContent = '';
	if (slot) {
		select.appendChild(element('b', '', slot.name));
		select.appendChild(element('span', 'account', ` · ${slot.account}`));
	} else {
		select.appendChild(element('span', 'placeholder', 'Pick a bot to watch…'));
	}
	node.querySelector('.toggle').classList.toggle('on', !!(slot && slot.scene));
	node.querySelector('.control').disabled = state !== 'watching';

	msg.style.display = text ? '' : 'none';
	if (text) {
		const [big, small] = text(slot && slot.name);
		msg.innerHTML = ICON[state];
		msg.appendChild(element('div', 'big', big));
		msg.appendChild(element('div', 'small', small));
	}
	scene(i);
}

/**
 * The hall's bots under a tile's select
 *
 * @param {number} i - slot
 */
function openDrop(i) {
	const drop = element('div', 'drop');
	const bots = BotHall.bots()
		.slice()
		.sort((a, b) => a.account.localeCompare(b.account));

	closeDrop();
	_drop = i;
	for (let j = 0; j < bots.length; ++j) {
		drop.appendChild(row(i, bots[j]));
	}
	if (!bots.length) {
		drop.appendChild(element('div', 'empty', 'No remote client in the hall.'));
	}
	_tiles[i].node.appendChild(drop);
}

function closeDrop() {
	if (_drop >= 0) {
		const drop = _tiles[_drop].node.querySelector('.drop');
		if (drop) {
			drop.remove();
		}
	}
	_drop = -1;
}

/**
 * @param {number} i - slot
 * @param {object} bot - hall row
 * @return {HTMLElement}
 */
function row(i, bot) {
	const node = element('div', 'row');
	const char = bot.playing || bot.chars[0] || { name: '', job: 0, lv: 0 };
	const picked = !!_slots[i] && _slots[i].account === bot.account;
	const busy = bot.windows >= MAX_WINDOWS && !(picked && _tiles[i].frame);
	const line = element('div', 'char', char.name);

	node.classList.toggle('off', !bot.playing);
	node.classList.toggle('busy', busy);
	node.classList.toggle('sel', picked);
	node.appendChild(element('span', 'dot', '●'));
	node.appendChild(element('span', 'name', bot.account));
	node.appendChild(
		element('span', 'map', busy ? `full · ${MAX_WINDOWS} windows` : bot.playing ? bot.playing.map : 'offline')
	);
	line.appendChild(element('span', 'job', `${MonsterTable[char.job] || ''} ${char.lv}`.trim()));
	node.appendChild(line);

	node.addEventListener('mousedown', event => {
		event.stopPropagation();
		if (!busy) {
			pick(i, bot);
		}
	});
	return node;
}

/**
 * Watch this bot in this tile, scene only to begin with
 *
 * @param {number} i - slot
 * @param {object} bot - hall row
 */
function pick(i, bot) {
	const char = bot.playing || bot.chars[0];

	closeDrop();
	leave(i);
	_slots[i] = { account: bot.account, name: char ? char.name : bot.account, scene: true };
	save();
	update();
}

/**
 * Export
 */
export default Camera;
