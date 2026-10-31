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
 * localStorage key of the relay a page link gave: the login screen shows the way to the bots from then on
 * @const {string}
 */
const RELAY_KEY = 'botHallRelay';

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
 * How long a bot has to answer a call, unless the caller says otherwise
 * @const {number}
 */
const CALL_WAIT_MS = 10000;

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
 * @var {object} _asked - open or call id -> {t, peer, resolve, reject, timer}, t being the answer awaited (room or ret)
 */
const _asked = Object.create(null);

/**
 * @var {number} _nextId
 */
let _nextId = 1;

/**
 * @var {?function} _onChange
 */
let _onChange = null;

/**
 * @var {Array<function>} _watchers - told of every change and of each bot's event
 */
let _watchers = [];

/**
 * @var {boolean} _keep - the hall stays joined in game
 */
let _keep = false;

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
		localStorage.removeItem(RELAY_KEY);
	} catch (_e) {
		// Nothing kept
	}
	BotHall.leave();
};

/**
 * @return {?{relay: string, relayKey: string}} the relay a page link gave
 */
BotHall.loadRelay = function loadRelay() {
	let r = null;

	try {
		r = JSON.parse(localStorage.getItem(RELAY_KEY));
	} catch (_e) {
		return null;
	}
	if (!r || typeof r.relay !== 'string') {
		return null;
	}
	return { relay: r.relay, relayKey: typeof r.relayKey === 'string' ? r.relayKey : '' };
};

/**
 * Keep the relay of a page link (?relay=, or a bot link): the settings start from it
 *
 * @param {string} relay
 * @param {string} [relayKey]
 */
BotHall.rememberRelay = function rememberRelay(relay, relayKey) {
	try {
		localStorage.setItem(RELAY_KEY, JSON.stringify({ relay, relayKey: relayKey || '' }));
	} catch (_e) {
		// Private mode: the way to the bots stays hidden
	}
};

/**
 * @param {?function} fn - called when the list or the state changes; null to stop
 */
BotHall.onChange = function onChange(fn) {
	_onChange = fn;
};

/**
 * @param {function(string, ...*)} fn - called with ('change') when the list or the state changes, and with
 *  ('ev', botId, name, data) for each event a bot sends
 * @return {function} stops it
 */
BotHall.watch = function watch(fn) {
	_watchers.push(fn);
	return () => {
		_watchers = _watchers.filter(w => w !== fn);
	};
};

/**
 * @param {boolean} on - the hall stays joined in game while on
 */
BotHall.keep = function keep(on) {
	_keep = !!on;
};

/**
 * @return {boolean} the hall stays joined in game
 */
BotHall.kept = function kept() {
	return _keep;
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
 * @param {string} name - a character
 * @param {string} map - without its extension
 * @return {?object} the bot that says it plays this character on this map
 */
BotHall.playing = function playing(name, map) {
	for (const id in _bots) {
		const p = _bots[id].playing;
		if (p && p.name === name && p.map === map) {
			return _bots[id];
		}
	}
	return null;
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
		for (const n in _asked) {
			if (_asked[n].peer === peer.id) {
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
		for (const n in _asked) {
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
	for (const id in _asked) {
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
	const n = _nextId++;

	if (!bot) {
		return Promise.reject(Object.assign(new Error('the bot left the hall'), { code: 'gone' }));
	}

	return new Promise((resolve, reject) => {
		_asked[n] = {
			t: 'room',
			peer: id,
			resolve,
			reject,
			timer: setTimeout(() => settle(n, null, 'no-answer'), OPEN_WAIT_MS)
		};
		send(bot.peer, { t: 'open', v: VERSION, id: n });
	});
};

/**
 * Ask a bot for one of the names it serves
 *
 * @param {string} id - the bot's peer id
 * @param {string} name - a-z first, then a-z 0-9 . _ -
 * @param {*} data - any JSON value
 * @param {number} [ms] - how long it has to answer
 * @return {Promise<*>} what it returned; rejected with an Error whose code is the bot's why, gone, no-answer or big
 * @see docs/reference/network/remote-bot.md
 */
BotHall.call = function callName(id, name, data, ms) {
	const bot = _bots[id];
	const n = _nextId++;
	let text;

	if (!bot) {
		return Promise.reject(Object.assign(new Error('the bot left the hall'), { code: 'gone' }));
	}
	try {
		text = encode({ t: 'call', v: VERSION, id: n, name, data });
	} catch (err) {
		return Promise.reject(Object.assign(err, { code: 'big' }));
	}

	return new Promise((resolve, reject) => {
		_asked[n] = {
			t: 'ret',
			peer: id,
			resolve,
			reject,
			timer: setTimeout(() => settle(n, null, 'no-answer'), ms || CALL_WAIT_MS)
		};
		bot.peer.send(text).catch(() => {
			// A peer gone meanwhile: its leave says so
		});
	});
};

/**
 * Send a bot an event; nothing comes back
 *
 * @param {string} id - the bot's peer id
 * @param {string} name
 * @param {*} data
 * @return {boolean} sent: the bot is listed and the event fits
 */
BotHall.emit = function emit(id, name, data) {
	const bot = _bots[id];

	if (!bot) {
		return false;
	}
	try {
		send(bot.peer, { t: 'ev', v: VERSION, name, data });
	} catch (err) {
		console.warn(`[BotHall] ${err.message}, event ${name} not sent`);
		return false;
	}
	return true;
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
		} else if (m.t === 'ev') {
			tell('ev', peer.id, m.name, m.data);
		} else if (asked(m, peer) === 'room') {
			settle(m.id, m.t === 'room' ? { room: m.room, secret: m.secret } : null, m.why);
		} else if (asked(m, peer) === 'ret') {
			settle(m.id, m.ok ? { data: m.data } : null, m.why);
		}
	});

	send(peer, { t: 'who', v: VERSION });
}

/**
 * @param {object} m - an answer
 * @param {object} peer - who sent it
 * @return {?string} the answer awaited under its id from that peer, if it is one
 */
function asked(m, peer) {
	const pending = _asked[m.id];
	const t = m.t === 'no' ? 'room' : m.t;

	return pending && pending.peer === peer.id && pending.t === t ? t : null;
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
 * @param {number} n - open or call id
 * @param {?object} answer - a call's is {data}
 * @param {?string} code - why it failed
 */
function settle(n, answer, code) {
	const pending = _asked[n];

	if (!pending) {
		return;
	}
	delete _asked[n];
	clearTimeout(pending.timer);
	if (!answer) {
		const what = pending.t === 'room' ? 'open' : 'call';
		pending.reject(Object.assign(new Error(`${what} refused: ${code}`), { code }));
	} else if (pending.t === 'ret') {
		pending.resolve(answer.data);
	} else {
		pending.resolve(answer);
	}
}

/**
 * Tell the list and the watchers
 */
function changed() {
	if (_onChange) {
		_onChange();
	}
	tell('change');
}

/**
 * @param {...*} args - what the watchers are told
 */
function tell(...args) {
	for (const fn of _watchers) {
		try {
			fn(...args);
		} catch (err) {
			console.warn(`[BotHall] a watcher failed: ${err.message}`);
		}
	}
}

/**
 * ?relay=<wss url>[&key=<relay key>] keeps the relay, then leaves the address bar
 */
function init() {
	const params = new URLSearchParams(window.location.search);
	const relay = params.get('relay');

	if (!relay) {
		return;
	}
	if (/^wss?:\/\/./.test(relay)) {
		BotHall.rememberRelay(relay, params.get('key'));
	}
	params.delete('relay');
	params.delete('key');
	const search = params.toString();
	history.replaceState(
		history.state,
		'',
		`${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`
	);
}

init();

/**
 * Export
 */
export default BotHall;
