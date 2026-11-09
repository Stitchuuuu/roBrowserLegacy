/**
 * Network/RemoteBot.js
 *
 * Remote mode: the game sockets ride a WebRTC peer of a running bot instead of a server
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import { joinRoom, parseLink } from 'Vendors/signal/index.js';
import RtcSockets from './SocketHelpers/RtcSockets.js';
import BotHall from './BotHall.js';
import CameraTile from './CameraTile.js';
import AutoRetry from 'Engine/AutoRetry.js';

/**
 * sessionStorage key of the link: a reload in the tab attaches again
 * @const {string}
 */
const STORAGE_KEY = 'remoteBot';

/**
 * What the player reads when the bot cannot be reached, by library error code
 * @const {object}
 */
const FAILURES = {
	'no-bot': 'Remote client: no remote client answered. Is it running, and is this link its current one?',
	secret: 'Remote client: the secret in this link is not valid.',
	key: 'Remote client: the relay refused the key.',
	'room-full': 'Remote client: another window is already attached to this remote client.',
	rate: 'Remote client: the relay cut this window (too many messages).',
	options: 'Remote client: the link is not valid.'
};

/**
 * @var {?RtcSockets} _sockets - the bot's room, once a link is known
 */
let _sockets = null;

/**
 * @var {?function(boolean)} _ask - shows the paste box, while the login screen is there
 */
let _ask = null;

/**
 * @var {boolean} _asking - a paste box waits for the login screen
 */
let _asking = false;

/**
 * @var {boolean} _badLink - the page link was no bot link
 */
let _badLink = false;

/**
 * @var {?string} _character - the character the bot plays, picked once listed
 */
let _character = null;

/**
 * @var {boolean} _listRoom - the room is one the bot list opened, not a link
 */
let _listRoom = false;

/**
 * @var {boolean} _inGame - the login is over: the mode no longer changes
 */
let _inGame = false;

/**
 * @var {?function(?object)} _onText - takes the bot's text messages, null when its peer left
 */
let _onText = null;

/**
 * @var {boolean} _control - this window holds the bot's control, as the bot last said
 */
let _control = false;

/**
 * @var {number} _elapsed - ms already run of the progress bar the snapshot carries
 */
let _elapsed = 0;

/**
 * @var {?object} _switch - the room another bot opened, attached to once back on the login screen
 */
let _switch = null;

/**
 * @var {boolean} _wantControl - take the control once in game, through the room in use
 */
let _wantControl = false;

/**
 * @var {?string} _account - the account of the bot the list opened
 */
let _account = null;

/**
 * @var {?string} _picked - the character picked at this room's character select
 */
let _picked = null;

/**
 * @var {?{retry: boolean, why: string}} _loginFail - why the bot could not log in with the character picked
 */
let _loginFail = null;

/**
 * @var {?object} _drop - the bot to come back to, once the list shows: see dropped()
 */
let _drop = null;

/**
 * @var {number} _attempt - picks tried again at a logged-out bot, 0 outside such a run
 */
let _attempt = 0;

const RemoteBot = {};

/**
 * @return {boolean} the game sockets go to the bot
 */
RemoteBot.isActive = function isActive() {
	return !!_sockets;
};

/**
 * Socket factory of the mode
 *
 * @return {object} a socket with the WebSocket helper's shape
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.socket = function socket() {
	return _sockets.socket();
};

/**
 * Use a bot link: page#r=<room>&s=<secret>&relay=<url>[&key=<relay key>]
 *
 * @param {string} text - the link
 * @return {boolean} false if it is no bot link, or the login is over
 */
RemoteBot.setLink = function setLink(text) {
	const link = parseLink(text.trim());

	if (_inGame || !link || !link.relay) {
		return false;
	}

	_character = null;
	_listRoom = false;
	_wantControl = false;
	join(link);
	BotHall.rememberRelay(link.relay, link.relayKey);
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
	} catch (_e) {
		// Private mode: a reload asks again
	}
	return true;
};

/**
 * Use a room a bot opened for this window (the bot list): nothing kept, a reload goes back to the list
 *
 * @param {{relay: string, relayKey: string, room: string, secret: string, character: ?string, control: ?boolean}} room -
 *   character: the one the bot plays; control: take its control once in game
 * @return {boolean} false once the login is over
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.useRoom = function useRoom(room) {
	if (_inGame) {
		return false;
	}

	_character = room.character || null;
	_listRoom = true;
	_wantControl = !!room.control;
	_account = room.account || null;
	join({ relay: room.relay, relayKey: room.relayKey || undefined, room: room.room, secret: room.secret });
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch (_e) {
		// Nothing kept
	}
	return true;
};

/**
 * The character to pick at the first character select of a room the list opened: once, so a player who goes
 * back to the character select stays there
 *
 * @return {?string} the one the bot plays
 */
RemoteBot.takeCharacter = function takeCharacter() {
	const name = _sockets ? _character : null;

	_character = null;
	return name;
};

/**
 * @return {boolean} the bot said this window holds its control
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.hasControl = function hasControl() {
	return !!_sockets && _control;
};

/**
 * Whether to take the control now that the window is in game: once per room
 *
 * @return {boolean}
 */
RemoteBot.takeWantControl = function takeWantControl() {
	const want = _wantControl && !CameraTile.active;

	_wantControl = false;
	return want;
};

/**
 * How much of the progress bar the snapshot carries has already run: once
 *
 * @return {number} ms
 */
RemoteBot.takeElapsed = function takeElapsed() {
	const elapsed = _elapsed;

	_elapsed = 0;
	return elapsed;
};

/**
 * Another bot opened a room for this window: attached to on the next login screen, with its control
 *
 * @param {{relay: string, relayKey: string, room: string, secret: string, character: ?string}} room
 * @return {boolean} false out of the game (no switch from the login screen), and in a camera tile
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.switchTo = function switchTo(room) {
	if (!_inGame || CameraTile.active) {
		return false;
	}
	_switch = { ...room, control: true };
	return true;
};

/**
 * @return {boolean} a room switchTo() kept waits for the login screen
 */
RemoteBot.switching = function switching() {
	return !!_switch;
};

/**
 * @return {?object} the room switchTo() kept, once
 */
RemoteBot.takeSwitch = function takeSwitch() {
	const room = _switch;

	_switch = null;
	return room;
};

/**
 * Who takes the bot's text messages (its commands, its log)
 *
 * @param {?function(?object)} fn - a parsed message, or null when the bot's peer left
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.onText = function onText(fn) {
	_onText = fn;
};

/**
 * Text to the bot, beside the sockets
 *
 * @param {object} message
 * @return {boolean} false without the bot's peer
 */
RemoteBot.sendText = function sendText(message) {
	return !!_sockets && _sockets.sendText(message);
};

/**
 * @param {string} name - the character picked at this room's character select, picked again by an auto-retry
 */
RemoteBot.picked = function picked(name) {
	_picked = name;
};

/**
 * The bot's sockets closed on their own: with auto-retry on, keep its bot to come back to on the list rather
 * than end the game in an error box. A pick the bot could not log in with is picked again, unless it can never
 * work (the bot said so); a bot lost otherwise is waited for until it plays again.
 *
 * @return {boolean} true: go back to the list at once, no error box
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.dropped = function dropped() {
	const fail = _loginFail;

	if (!_sockets || !_listRoom || !_account || CameraTile.active || !AutoRetry.isEnabled()) {
		return false;
	}
	if (fail && !fail.retry) {
		return false;
	}

	_loginFail = null;
	_drop = {
		account: _account,
		character: fail ? _picked : null,
		control: _control,
		repick: !!fail,
		why: fail ? fail.why : ''
	};
	_attempt = fail ? Math.max(1, _attempt) + 1 : 0;
	return true;
};

/**
 * @return {?{account: string, character: ?string, control: boolean, repick: boolean, why: string}} the bot
 *   dropped() kept, once: repick, pick that character again; otherwise wait for the bot to play again
 */
RemoteBot.takeDrop = function takeDrop() {
	const drop = _drop;

	_drop = null;
	return drop;
};

/**
 * @return {boolean} a bot dropped() kept waits for the remote characters
 */
RemoteBot.returning = function returning() {
	return !!_drop;
};

/**
 * @return {string} why the bot could not log in with the character picked, for the error box dropped() left
 */
RemoteBot.loginFailure = function loginFailure() {
	return _loginFail ? _loginFail.why : '';
};

/**
 * @return {number} the pick an auto-retry runs at a logged-out bot, from the second one on; 0 otherwise
 */
RemoteBot.attempt = function attempt() {
	return _attempt;
};

/**
 * The auto-retry run is over: in game, cancelled, or another bot taken
 */
RemoteBot.stopRetry = function stopRetry() {
	_attempt = 0;
};

/**
 * Back to the server from a room the bot list opened; a link stays
 */
RemoteBot.leave = function leave() {
	if (_inGame || !_listRoom) {
		return;
	}
	_listRoom = false;

	if (_sockets) {
		_sockets.leave();
		_sockets = null;
	}
	_character = null;
	_wantControl = false;
	_account = null;
};

/**
 * The login screen is shown (with its paste box), or left for good
 *
 * @param {?function(boolean)} ask - opens the paste box, told whether the last link was bad; null once logged in
 */
RemoteBot.setLoginScreen = function setLoginScreen(ask) {
	_ask = ask;
	_inGame = !ask;

	if (ask && _asking) {
		_asking = false;
		ask(_badLink);
		_badLink = false;
	}
};

/**
 * Why the bot could not be reached; a link that can never work is forgotten
 *
 * @return {?{text: string, permanent: boolean}} null outside the mode or without failure
 * @see docs/reference/network/remote-bot.md
 */
RemoteBot.failure = function failure() {
	const code = _sockets && _sockets.failure();
	const permanent = code !== 'no-bot';

	if (!code) {
		return null;
	}

	if (permanent) {
		try {
			sessionStorage.removeItem(STORAGE_KEY);
		} catch (_e) {
			// Nothing kept
		}
	}

	return {
		text: FAILURES[code] || `Remote client: cannot reach the relay (${code}).`,
		permanent: permanent
	};
};

/**
 * Join the bot's room
 *
 * @param {object} link - parseLink() result
 */
function join(link) {
	if (_sockets) {
		_sockets.leave();
	}
	_sockets = new RtcSockets(joinRoom({ ...link, max: 2 }));
	_control = false;
	_elapsed = 0;
	_picked = null;
	_loginFail = null;
	_sockets.onText = text => {
		let message = null;

		if (text !== null) {
			try {
				message = JSON.parse(text);
			} catch (_e) {
				return;
			}
			if (!message || typeof message !== 'object') {
				return;
			}
			const t = message.t;
			if (t === 'control') {
				_control = message.on === true;
			} else if (t === 'progress') {
				_elapsed = Math.max(0, Number(message.elapsed) || 0);
				return;
			} else if (t === 'character') {
				// The bot switched characters on its own: this character select picks the one it took
				_character = typeof message.name === 'string' ? message.name.slice(0, 24) : null;
				return;
			} else if (t === 'loginfail') {
				// Before the bot closes the character select: dropped() reads it
				_loginFail = { retry: message.retry === true, why: String(message.why || '').slice(0, 200) };
				return;
			}
		} else {
			_control = false;
			_elapsed = 0;
		}
		if (_onText) {
			_onText(message);
		}
	};
}

/**
 * Paste box: now on the login screen, before it once it is there, never in game nor in a camera tile
 *
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
	if (_inGame || CameraTile.active || !event.altKey || !event.shiftKey || event.code !== 'KeyR') {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	if (_ask) {
		_ask(false);
	} else {
		_asking = true;
	}
}

/**
 * #remote&r=...&s=... joins at once, #remote alone reuses this tab's link or asks
 */
function init() {
	const hash = window.location.hash;
	const params = new URLSearchParams(hash.slice(1));
	let stored = null;

	if (!params.has('remote')) {
		return;
	}

	// No secret left in the address bar; #remote alone is the bookmark
	history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#remote`);

	if (params.has('r') || params.has('s')) {
		if (!RemoteBot.setLink(hash)) {
			_badLink = true;
			_asking = true;
		}
		return;
	}

	try {
		stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
	} catch (_e) {
		// Nothing kept
	}

	if (stored) {
		join(stored);
	} else {
		_asking = true;
	}
}

window.addEventListener('keydown', onKeyDown, true);
init();

/**
 * Export
 */
export default RemoteBot;
