/**
 * UI/Components/RemoteSettings/RemoteSettings.js
 *
 * Where this browser finds the account's bots: the relay, its key, the hall and its secret
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Renderer from 'Renderer/Renderer.js';
import KEYS from 'Controls/KeyEventHandler.js';
import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import BotHall from 'Network/BotHall.js';
import { newSecret, formatLink } from 'Vendors/signal/index.js';
import 'UI/Elements/Elements.js';
import htmlText from './RemoteSettings.html?raw';
import cssText from './RemoteSettings.css?raw';

/**
 * The warning shown under the fields until something else has to be said
 * @const {string}
 */
const WARNING = '⚠︎ Anyone with this secret can open your remote clients.';

/**
 * Create component
 */
const RemoteSettings = new GUIComponent('RemoteSettings', cssText);

RemoteSettings.render = () => htmlText;

/**
 * Modal: nothing else is clicked while it is open
 */
RemoteSettings.mouseMode = GUIComponent.MouseMode.FREEZE;

/**
 * Typing goes to its fields
 */
RemoteSettings.captureKeyEvents = true;

/**
 * Initialize UI
 */
RemoteSettings.init = function init() {
	const root = this.getRoot();

	this._host.style.top = `${(Renderer.height - 212) / 1.5}px`;
	this._host.style.left = `${(Renderer.width - 320) / 2}px`;
	this.draggable(root.querySelector('.titlebar'));

	const inputs = root.querySelectorAll('input');
	for (let i = 0; i < inputs.length; ++i) {
		inputs[i].addEventListener('mousedown', event => event.stopImmediatePropagation());
	}
	root.querySelector('.new').addEventListener('click', () => {
		root.querySelector('.secret').value = newSecret();
		say('A new secret: copy it to your remote clients.');
	});
	root.querySelector('.copy').addEventListener('click', () => copy());
	root.querySelector('.forget').addEventListener('click', () => {
		BotHall.forgetSettings();
		RemoteSettings.onClose();
	});
	root.querySelector('.ok').addEventListener('click', () => validate());
	root.querySelector('.cancel').addEventListener('click', () => RemoteSettings.onClose());
};

/**
 * Show the saved settings
 */
RemoteSettings.onAppend = function onAppend() {
	const root = this.getRoot();
	const relay = BotHall.loadRelay() || { relay: '', relayKey: '' };
	const settings = BotHall.loadSettings() || { relay: relay.relay, relayKey: relay.relayKey, room: '', secret: '' };

	root.querySelector('.relay').value = settings.relay;
	root.querySelector('.relayKey').value = settings.relayKey;
	root.querySelector('.room').value = settings.room;
	root.querySelector('.secret').value = settings.secret;
	say(WARNING);
	root.querySelector('.relay').focus();
};

/**
 * Key Management
 *
 * @param {object} event
 * @return {boolean}
 */
RemoteSettings.onKeyDown = function onKeyDown(event) {
	if (event.which === KEYS.ENTER) {
		validate();
	} else if (event.which === KEYS.ESCAPE) {
		RemoteSettings.onClose();
	}
	event.stopImmediatePropagation();
	return true;
};

/**
 * Callback to define: the window is done (saved, forgotten or cancelled)
 */
RemoteSettings.onClose = function onClose() {
	// Set by LoginEngine
};

/**
 * @return {{relay: string, relayKey: string, room: string, secret: string}}
 */
function read() {
	const root = RemoteSettings.getRoot();

	return {
		relay: root.querySelector('.relay').value.trim(),
		relayKey: root.querySelector('.relayKey').value.trim(),
		room: root.querySelector('.room').value.trim(),
		secret: root.querySelector('.secret').value.trim()
	};
}

/**
 * @param {string} text
 * @param {boolean} [error]
 */
function say(text, error) {
	const note = RemoteSettings.getRoot().querySelector('.note');

	note.textContent = text;
	note.classList.toggle('error', !!error);
}

/**
 * @param {{relay: string, relayKey: string, room: string, secret: string}} settings
 * @return {?string} what is wrong, null when nothing is
 */
function check(settings) {
	if (!/^wss?:\/\/./.test(settings.relay)) {
		return 'The relay is a wss:// address.';
	}
	if (!settings.room || settings.room.length > 64) {
		return 'Name the hall (64 characters at most).';
	}
	if (!/^[\w-]{43}$/.test(settings.secret)) {
		return 'The secret is not valid: press New for one.';
	}
	return null;
}

/**
 * Save and close, or say what is wrong
 */
function validate() {
	const settings = read();
	const wrong = check(settings);

	if (wrong) {
		say(wrong, true);
		return;
	}

	BotHall.saveSettings(settings);
	// The list joins the saved hall when it shows
	BotHall.leave();
	RemoteSettings.onClose();
}

/**
 * The console line that puts a remote client in this hall: /remote <hall link>
 * @see docs/reference/network/remote-bot.md
 */
function copy() {
	const settings = read();
	const wrong = check(settings);

	if (wrong) {
		say(wrong, true);
		return;
	}
	if (!navigator.clipboard) {
		say('This browser cannot copy here.', true);
		return;
	}
	navigator.clipboard.writeText(`/remote ${formatLink('', settings)}`).then(
		() => say('Copied: paste it into the console of each remote client.'),
		() => say('This browser refused to copy.', true)
	);
}

/**
 * Stored component and return it
 */
export default UIManager.addComponent(RemoteSettings);
