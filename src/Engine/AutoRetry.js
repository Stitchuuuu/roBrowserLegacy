/**
 * Engine/AutoRetry.js
 *
 * Replay the login form until the char server accepts us, and the character
 * pick until the map server does.
 *
 * Opt-in, from the checkbox under the login window. While armed it holds the
 * credentials the form submitted, counts the attempts so the loading popup can
 * show which one is running, and re-fires the connection after a failure that
 * can clear on its own, waiting longer each time.
 *
 * It does not decide *when* it runs: the engines call in. They own the UI and
 * the sockets, this owns the state and the policy.
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Preferences from 'Core/Preferences.js';

/**
 * Its own preferences key rather than a field in 'WinLogin': that one is
 * written by every login UI version, each serialising the whole object, so a
 * key only one of them knows about does not survive the others saving.
 */
const _preferences = Preferences.get(
	'AutoRetry',
	{
		enabled: false
	},
	1.0
);

/**
 * @var {Array} milliseconds a failure stays on screen before the next attempt,
 * by attempt that failed, the last one repeating
 */
const DELAYS = [3000, 6000, 12000, 24000, 30000];

/**
 * Failures worth replaying, by packet. Everything absent here fails the same
 * way forever — wrong or expired credentials, bans, an outdated client — so
 * retrying it only burns login attempts.
 *
 * @var {object} AC_REFUSE_LOGIN error codes
 */
const RETRY_REFUSE = {
	3: true, // Rejected from Server
	4: true, // Login is currently unavailable, please try again shortly
	7: true, // Server is jammed due to over populated
	100: true // Login information remains at %s
};

/**
 * @var {object} SC_NOTIFY_BAN error codes
 */
const RETRY_BAN = {
	1: true, // Server closed
	4: true, // Server is jammed due to over populated
	8: true // The server still recognizes your last log-in
};

let _username = '';
let _password = '';
let _attempt = 0;
let _timer = 0;

const AutoRetry = {};

/**
 * Is the feature turned on ? Read by the checkbox and by the engines, which
 * only arm when it is.
 *
 * @returns {boolean}
 */
AutoRetry.isEnabled = function isEnabled() {
	return _preferences.enabled;
};

/**
 * @param {boolean} enabled
 */
AutoRetry.setEnabled = function setEnabled(enabled) {
	_preferences.enabled = !!enabled;
	_preferences.save();

	if (!_preferences.enabled) {
		AutoRetry.disarm();
	}
};

/**
 * Count this attempt and keep its credentials for the next one. Picking a
 * character arms without any: there is no login to replay from there.
 *
 * @param {string} [username]
 * @param {string} [password]
 */
AutoRetry.arm = function arm(username = '', password = '') {
	_username = username;
	_password = password;
	_attempt++;
};

/**
 * @returns {boolean} true between a connection request and the server it aims at
 */
AutoRetry.armed = function armed() {
	return _attempt > 0;
};

/**
 * @returns {number} attempt currently running, 0 when not armed
 */
AutoRetry.attempt = function attempt() {
	return _attempt;
};

/** Stop retrying: the server accepted us, or the player clicked through. */
AutoRetry.disarm = function disarm() {
	if (_timer) {
		clearTimeout(_timer);
		_timer = 0;
	}
	_username = '';
	_password = '';
	_attempt = 0;
};

/**
 * Stop retrying and hand control back to the login window. The 'ok' callback
 * for the failures an engine would otherwise answer with showErrorBox, whose
 * only exit is a full game reload — too much when the form is one step away,
 * and the player only sees this box because they armed the loop.
 */
AutoRetry.cancel = function cancel() {
	AutoRetry.disarm();
	AutoRetry.onCancel();
};

/**
 * Can this failure clear on its own ?
 *
 * @param {string} kind - 'network', 'refuse' or 'ban'
 * @param {number} code - server error code, ignored for 'network'
 * @returns {boolean}
 */
AutoRetry.canRetry = function canRetry(kind, code) {
	// Armed from char select: no credentials to log in again with
	if (!AutoRetry.armed() || !_username) {
		return false;
	}
	switch (kind) {
		case 'network':
			return true;
		case 'refuse':
			return !!RETRY_REFUSE[code];
		case 'ban':
			return !!RETRY_BAN[code];
	}
	return false;
};

/**
 * Leave the failure on screen long enough to read, then take it down and try
 * again. The box is dismissed from here rather than by its own button so the
 * loop needs no click — and clicking the button instead cancels, because that
 * path disarms.
 *
 * @param {object} box - component returned by UIManager.showMessageBox
 * @param {function} [retry] - next attempt, the login replay by default
 */
AutoRetry.schedule = function schedule(box, retry = AutoRetry.onRetry) {
	if (_timer) {
		clearTimeout(_timer);
	}
	_timer = setTimeout(
		() => {
			_timer = 0;
			if (!AutoRetry.armed()) {
				return;
			}
			if (box) {
				box.remove();
			}
			retry(_username, _password);
		},
		DELAYS[Math.min(_attempt, DELAYS.length) - 1]
	);
};

/**
 * Both set by LoginEngine, which is the only place that knows how to get back
 * to a clean socket and either re-enter the connection or re-show the form.
 * Assigned rather than imported so the two files do not import each other.
 */
AutoRetry.onRetry = function onRetry() {};
AutoRetry.onCancel = function onCancel() {};

export default AutoRetry;
