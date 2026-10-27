/**
 * Network/RemoteBot.js
 *
 * Remote mode: the game sockets ride a WebRTC peer of a running bot instead of a server
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import { joinRoom, parseLink } from 'Vendors/signal/index.js';
import RtcSockets from './SocketHelpers/RtcSockets.js';

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
	join(link);
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
 * @param {{relay: string, relayKey: string, room: string, secret: string, character: ?string}} room - character: the one the bot plays
 * @return {boolean} false once the login is over
 */
RemoteBot.useRoom = function useRoom(room) {
	if (_inGame) {
		return false;
	}

	_character = room.character || null;
	_listRoom = true;
	join({ relay: room.relay, relayKey: room.relayKey || undefined, room: room.room, secret: room.secret });
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch (_e) {
		// Nothing kept
	}
	return true;
};

/**
 * @return {?string} the character to pick once listed, the one the bot plays
 */
RemoteBot.character = function character() {
	return _sockets ? _character : null;
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
}

/**
 * Paste box: now on the login screen, before it once it is there, never in game
 *
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
	if (_inGame || !event.altKey || !event.shiftKey || event.code !== 'KeyR') {
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
