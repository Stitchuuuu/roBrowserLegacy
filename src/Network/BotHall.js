/**
 * Network/BotHall.js
 *
 * The account's hall: the room where every bot of the account announces itself, and the list of who is there
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import { joinRoom } from 'Vendors/signal/index.js';
import { VERSION, encode, parse } from './HallMessages.js';

/**
 * localStorage key of the hall settings
 * @const {string}
 */
const SETTINGS_KEY = 'botHall';

/**
 * Members a hall holds: the page and the bots of the account (the relay caps it too)
 * @const {number}
 */
const HALL_MAX = 40;

/**
 * How long a bot has to answer an open
 * @const {number}
 */
const OPEN_WAIT_MS = 15000;

/**
 * @var {?object} _room - the hall, once joined
 */
let _room = null;

/**
 * @var {string} _state - off, joining, in, or the library code that closed the hall
 */
let _state = 'off';

/**
 * @var {object} _bots - peer id -> {id, via, peer, kind, account, chars, playing, windows}, once it said hello
 */
let _bots = Object.create(null);

/**
 * @var {object} _opens - open id -> {peer, resolve, reject, timer}
 */
const _opens = Object.create(null);

/**
 * @var {number} _nextOpen
 */
let _nextOpen = 1;

/**
 * @var {?function} _onChange
 */
let _onChange = null;

const BotHall = {};

/**
 * @return {?{relay: string, relayKey: string, room: string, secret: string}} the saved settings
 */
BotHall.loadSettings = function loadSettings() {
	let s = null;

	try {
		s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
	} catch (_e) {
		return null;
	}
	if (!s || typeof s.relay !== 'string' || typeof s.room !== 'string' || typeof s.secret !== 'string') {
		return null;
	}
	return {
		relay: s.relay,
		relayKey: typeof s.relayKey === 'string' ? s.relayKey : '',
		room: s.room,
		secret: s.secret
	};
};

/**
 * @param {{relay: string, relayKey: string, room: string, secret: string}} settings
 */
BotHall.saveSettings = function saveSettings(settings) {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch (_e) {
		// Private mode: asked again next time
	}
};

/**
 * Forget the settings and leave the hall
 */
BotHall.forgetSettings = function forgetSettings() {
	try {
		localStorage.removeItem(SETTINGS_KEY);
	} catch (_e) {
		// Nothing kept
	}
	BotHall.leave();
};

/**
 * @param {?function} fn - called when the list or the state changes; null to stop
 */
BotHall.onChange = function onChange(fn) {
	_onChange = fn;
};

/**
 * @return {string} off, joining, in, or the library code that closed the hall
 */
BotHall.state = function state() {
	return _state;
};

/**
 * @return {Array<object>} the bots that said hello, by account then character
 */
BotHall.bots = function bots() {
	const list = [];

	for (const id in _bots) {
		list.push(_bots[id]);
	}
	return list.sort((a, b) => label(a).localeCompare(label(b)));
};

/**
 * @return {number} members of the hall that have not said who they are yet
 */
BotHall.waiting = function waiting() {
	return _room ? _room.members.filter(id => !_bots[id]).length : 0;
};

/**
 * Join the hall, leaving the one before
 *
 * @param {{relay: string, relayKey: string, room: string, secret: string}} settings
 * @see docs/reference/network/remote-bot.md
 */
BotHall.join = function join(settings) {
	BotHall.leave();

	const room = joinRoom({
		relay: settings.relay,
		relayKey: settings.relayKey || undefined,
		room: settings.room,
		secret: settings.secret,
		max: HALL_MAX,
		connect: 'manual'
	});

	_room = room;
	_state = 'joining';

	room.on('members', ids => {
		if (room !== _room) {
			return;
		}
		for (const id in _bots) {
			if (ids.indexOf(id) < 0) {
				delete _bots[id];
			}
		}
		for (let i = 0, count = ids.length; i < count; ++i) {
			call(room, ids[i]);
		}
		changed();
	});
	room.on('peer', peer => link(room, peer));
	room.on('leave', peer => {
		if (room !== _room) {
			return;
		}
		delete _bots[peer.id];
		for (const n in _opens) {
			if (_opens[n].peer === peer.id) {
				settle(Number(n), null, 'gone');
			}
		}
		changed();
		// A cut link does not come back by itself
		if (room.members.indexOf(peer.id) >= 0) {
			call(room, peer.id);
		}
	});
	room.on('error', err => {
		console.warn(`[BotHall] ${err.code}: ${err.message}`);
	});
	room.on('close', err => {
		if (room !== _room) {
			return;
		}
		_state = err ? err.code : 'off';
		_bots = Object.create(null);
		for (const n in _opens) {
			settle(Number(n), null, 'gone');
		}
		changed();
	});
	room.ready.then(
		() => {
			if (room === _room) {
				_state = 'in';
				changed();
			}
		},
		() => {
			// Reported by close
		}
	);
	changed();
};

/**
 * Leave the hall: once in game, or for other settings
 */
BotHall.leave = function leave() {
	const room = _room;

	_room = null;
	_state = 'off';
	_bots = Object.create(null);
	for (const id in _opens) {
		settle(Number(id), null, 'gone');
	}
	if (room) {
		room.leave();
		changed();
	}
};

/**
 * Ask a bot for a room of its own
 *
 * @param {string} id - the bot's peer id
 * @return {Promise<{room: string, secret: string}>} rejected with an Error whose code is the bot's refusal, gone or no-answer
 * @see docs/reference/network/remote-bot.md
 */
BotHall.open = function open(id) {
	const bot = _bots[id];
	const n = _nextOpen++;

	if (!bot) {
		return Promise.reject(Object.assign(new Error('the bot left the hall'), { code: 'gone' }));
	}

	return new Promise((resolve, reject) => {
		_opens[n] = {
			peer: id,
			resolve,
			reject,
			timer: setTimeout(() => settle(n, null, 'no-answer'), OPEN_WAIT_MS)
		};
		send(bot.peer, { t: 'open', v: VERSION, id: n });
	});
};

/**
 * @param {object} bot
 * @return {string}
 */
function label(bot) {
	return `${bot.account}\u0000${bot.playing ? bot.playing.name : ''}`;
}

/**
 * Link to a member; a link that fails is tried again on the next members change
 *
 * @param {object} room
 * @param {string} id
 */
function call(room, id) {
	room.connect(id).catch(err => {
		console.warn(`[BotHall] ${id}: ${err.code}`);
	});
}

/**
 * A linked member: asked who it is, its answers read
 *
 * @param {object} room
 * @param {object} peer
 */
function link(room, peer) {
	if (room !== _room) {
		return;
	}

	peer.on('message', data => {
		let m;

		if (room !== _room) {
			return;
		}
		try {
			m = parse(data);
		} catch (err) {
			console.warn(`[BotHall] ${err.message}, ${peer.id} cut`);
			delete _bots[peer.id];
			peer.close();
			changed();
			return;
		}
		if (!m) {
			return;
		}

		if (m.t === 'hello') {
			_bots[peer.id] = Object.assign(m, { id: peer.id, via: peer.via, peer: peer });
			changed();
		} else if ((m.t === 'room' || m.t === 'no') && _opens[m.id] && _opens[m.id].peer === peer.id) {
			settle(m.id, m.t === 'room' ? { room: m.room, secret: m.secret } : null, m.why);
		}
	});

	send(peer, { t: 'who', v: VERSION });
}

/**
 * @param {object} peer
 * @param {object} m
 */
function send(peer, m) {
	peer.send(encode(m)).catch(() => {
		// A peer gone meanwhile: its leave says so
	});
}

/**
 * @param {number} n - open id
 * @param {?object} answer
 * @param {?string} code - why it failed
 */
function settle(n, answer, code) {
	const pending = _opens[n];

	if (!pending) {
		return;
	}
	delete _opens[n];
	clearTimeout(pending.timer);
	if (answer) {
		pending.resolve(answer);
	} else {
		pending.reject(Object.assign(new Error(`open refused: ${code}`), { code }));
	}
}

/**
 * Tell the list
 */
function changed() {
	if (_onChange) {
		_onChange();
	}
}

/**
 * Export
 */
export default BotHall;
