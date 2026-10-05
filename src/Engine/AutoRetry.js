/**
 * Engine/AutoRetry.js
 *
 * Replay the login form until the char server accepts us.
 *
 * Opt-in, from the checkbox under the login window. While armed it holds the
 * credentials the form submitted, counts the attempts so the loading popup can
 * show which one is running, and re-fires the connection a few seconds after a
 * failure that can clear on its own.
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
 * @var {number} milliseconds a failure stays on screen before the next attempt
 */
const DELAY = 3000;

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
	2: true, // Someone has logged in with this ID
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
 * Keep the credentials for the next attempt and count this one.
 *
 * @param {string} username
 * @param {string} password
 */
AutoRetry.arm = function arm(username, password) {
	_username = username;
	_password = password;
	_attempt++;
};

/**
 * @returns {boolean} true between a connection request and the char server
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

/** Stop retrying: the char server accepted us, or the player clicked through. */
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
	if (!AutoRetry.armed()) {
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
 */
AutoRetry.schedule = function schedule(box) {
	if (_timer) {
		clearTimeout(_timer);
	}
	_timer = setTimeout(() => {
		_timer = 0;
		if (!AutoRetry.armed()) {
			return;
		}
		if (box) {
			box.remove();
		}
		AutoRetry.onRetry(_username, _password);
	}, DELAY);
};

/**
 * Both set by LoginEngine, which is the only place that knows how to get back
 * to a clean socket and either re-enter the connection or re-show the form.
 * Assigned rather than imported so the two files do not import each other.
 */
AutoRetry.onRetry = function onRetry() {};
AutoRetry.onCancel = function onCancel() {};

export default AutoRetry;
