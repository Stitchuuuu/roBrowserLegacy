/**
 * Network/RemoteBot.js
 *
 * Remote mode: the game sockets ride a WebRTC peer of a running bot instead of a server
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @see docs/reference/network/remote-bot.md
 */

import { joinRoom, parseLink } from 'Vendors/signal/index.js';
import RtcSockets from './SocketHelpers/RtcSocket.js';

/**
 * sessionStorage key of the link: a reload in the tab attaches again
 * @const {string}
 */
const STORAGE_KEY = 'remoteBot';

/**
 * What the player reads when the bot cannot be reached
 * @const {object}
 */
const FAILURES = {
	'no-bot': 'Remote bot: no bot answered in this room.',
	secret: 'Remote bot: wrong secret for this room.',
	key: 'Remote bot: the relay refused the key.',
	'room-full': 'Remote bot: another window is already attached to this bot.',
	rate: 'Remote bot: the relay is busy, try again later.',
	banned: 'Remote bot: the relay is busy, try again later.',
	options: 'Remote bot: the link is not valid.'
};

/**
 * @var {?{room: string, secret: string, relay: string, relayKey: ?string}}
 */
let _link = null;

/**
 * @var {?RtcSockets}
 */
let _sockets = null;

/**
 * A link is asked for (#remote alone, or the shortcut)
 * @var {boolean}
 */
let _asking = false;

/**
 * A game socket was made: the mode no longer changes
 * @var {boolean}
 */
let _started = false;

const RemoteBot = {};

/**
 * Show the paste box, set by the login screen
 * @var {?function}
 */
RemoteBot.onAsk = null;

/**
 * @return {boolean}
 */
RemoteBot.isActive = function isActive() {
	return !!_link;
};

/**
 * @return {boolean} a link is asked for and not shown yet
 */
RemoteBot.isAsking = function isAsking() {
	return _asking;
};

/**
 * Use a bot link: page#r=<room>&s=<secret>&relay=<url>[&key=<relay key>]
 *
 * @param {string} text - the link, or only what follows its #
 * @return {boolean} false if it is no bot link
 */
RemoteBot.setLink = function setLink(text) {
	const value = String(text).trim();
	const link = parseLink(value.indexOf('#') < 0 ? '#' + value : value);

	if (_started || !link || !link.relay) {
		return false;
	}

	_asking = false;
	join(link);
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(link));
	} catch (_e) {
		// Private mode: a reload asks again
	}
	return true;
};

/**
 * Socket factory of the mode
 *
 * @return {object} a socket with the WebSocket helper's shape
 */
RemoteBot.socket = function socket() {
	_started = true;
	return _sockets.socket();
};

/**
 * @return {?string} why the bot could not be reached, for the player
 */
RemoteBot.failText = function failText() {
	const code = _sockets && _sockets.failure();

	if (!code) {
		return null;
	}
	return FAILURES[code] || 'Remote bot: cannot reach the relay (' + code + ').';
};

/**
 * @return {?string} 'direct' or 'relay' while the bot's peer is there
 */
RemoteBot.via = function via() {
	return _sockets && _sockets.via;
};

/**
 * Join the bot's room
 *
 * @param {object} link - parseLink() result
 */
function join(link) {
	const options = { relay: link.relay, room: link.room, secret: link.secret, max: 2 };

	if (link.relayKey) {
		options.relayKey = link.relayKey;
	}
	if (_sockets) {
		_sockets.leave();
	}

	_link = link;
	_sockets = new RtcSockets(joinRoom(options));
}

/**
 * Open the paste box, now or once the login screen is there
 */
function ask() {
	_asking = true;
	if (RemoteBot.onAsk) {
		RemoteBot.onAsk();
	}
}

/**
 * #remote&r=…&s=… joins at once, #remote alone reuses this tab's link or asks
 */
function init() {
	const hash = window.location.hash;
	let stored = null;

	if (!new URLSearchParams(hash.slice(1)).has('remote')) {
		return;
	}

	if (RemoteBot.setLink(hash)) {
		// No secret left in the address bar; #remote alone is the bookmark
		history.replaceState(history.state, '', window.location.pathname + window.location.search + '#remote');
		return;
	}

	try {
		stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
	} catch (_e) {
		stored = null;
	}

	if (stored && stored.room && stored.secret && stored.relay) {
		join(stored);
		return;
	}
	ask();
}

window.addEventListener(
	'keydown',
	function onKeyDown(event) {
		if (event.altKey && event.shiftKey && event.code === 'KeyR' && !_started) {
			event.preventDefault();
			event.stopPropagation();
			ask();
		}
	},
	true
);

init();

/**
 * Export
 */
export default RemoteBot;
