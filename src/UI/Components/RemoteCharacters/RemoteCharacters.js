/**
 * UI/Components/RemoteCharacters/RemoteCharacters.js
 *
 * The bots of the account, from its hall: pick one and the window attaches to it
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Renderer from 'Renderer/Renderer.js';
import KEYS from 'Controls/KeyEventHandler.js';
import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import MonsterTable from 'DB/Monsters/MonsterTable.js';
import BotHall from 'Network/BotHall.js';
import 'UI/Elements/Elements.js';
import htmlText from './RemoteCharacters.html?raw';
import cssText from './RemoteCharacters.css?raw';

/**
 * What the player reads when the hall is closed, by library error code
 * @const {object}
 * @see docs/reference/network/remote-bot.md
 */
const HALL_FAILURES = {
	off: 'Set your hall in Settings.',
	key: 'The relay refused the key. Check it in Settings.',
	secret: 'The hall secret is not valid. Check it in Settings.',
	options: 'These settings are not valid. Check them in Settings.',
	'room-full': 'The hall is full.',
	rate: 'The relay cut this window (too many messages).'
};

/**
 * What the player reads when a bot does not open, by refusal
 * @const {object}
 */
const OPEN_FAILURES = {
	busy: 'This remote client has too many windows open.',
	gone: 'This remote client left the hall.',
	'no-answer': 'This remote client did not answer.'
};

/**
 * Create component
 */
const RemoteCharacters = new GUIComponent('RemoteCharacters', cssText);

RemoteCharacters.render = () => htmlText;

/**
 * @var {?string} _selected - peer id of the selected bot
 */
let _selected = null;

/**
 * @var {?string} _opening - peer id of the bot asked for a room
 */
let _opening = null;

/**
 * @var {?{id: string, text: string}} _failure - the last open that failed, shown on its row
 */
let _failure = null;

/**
 * @var {number} _shown - counts the times the list was removed: an answer for an older list is dropped
 */
let _shown = 0;

/**
 * Initialize UI
 */
RemoteCharacters.init = function init() {
	const root = this.getRoot();

	this._host.style.top = `${(Renderer.height - 200) / 1.5}px`;
	this._host.style.left = `${(Renderer.width - 280) / 2}px`;
	this.draggable(root.querySelector('.titlebar'));

	root.querySelector('.settings').addEventListener('click', () => RemoteCharacters.onSettingsRequest());
	root.querySelector('.login').addEventListener('click', () => RemoteCharacters.onLoginRequest());
	root.querySelector('.connect').addEventListener('click', () => open());
	// On the list, not the rows: a row is rebuilt when the hall changes
	root.querySelector('.list').addEventListener('dblclick', event => {
		if (event.target.closest('.bot')) {
			open();
		}
	});
};

/**
 * Join the hall of the saved settings
 */
RemoteCharacters.onAppend = function onAppend() {
	const settings = BotHall.loadSettings();

	_selected = null;
	_opening = null;
	_failure = null;
	BotHall.onChange(update);
	if (settings && BotHall.state() === 'off') {
		BotHall.join(settings);
	}
	update();
};

/**
 * Stop drawing: the hall stays until the login is over or the player leaves it
 */
RemoteCharacters.onRemove = function onRemove() {
	BotHall.onChange(null);
	_shown++;
};

/**
 * Key Management
 *
 * @param {object} event
 * @return {boolean}
 */
RemoteCharacters.onKeyDown = function onKeyDown(event) {
	const bots = BotHall.bots();
	const at = bots.findIndex(bot => bot.id === _selected);

	switch (event.which) {
		case KEYS.ENTER:
			open();
			break;
		case KEYS.UP:
			select(bots[Math.max(0, at - 1)]);
			break;
		case KEYS.DOWN:
			select(bots[Math.min(bots.length - 1, at + 1)]);
			break;
		default:
			return true;
	}
	event.stopImmediatePropagation();
	return false;
};

/**
 * Callbacks to define
 */
RemoteCharacters.onSettingsRequest = function onSettingsRequest() {
	// Set by LoginEngine
};
RemoteCharacters.onLoginRequest = function onLoginRequest() {
	// Set by LoginEngine
};
RemoteCharacters.onRoomOpened = function onRoomOpened() {
	// Set by LoginEngine
};

/**
 * @param {?object} bot
 */
function select(bot) {
	if (bot && !_opening) {
		_selected = bot.id;
		mark();
	}
}

/**
 * Show the selection without rebuilding the rows (a rebuilt row would lose a double click)
 */
function mark() {
	const root = RemoteCharacters.getRoot();
	const rows = root.querySelectorAll('.bot');

	for (let i = 0; i < rows.length; ++i) {
		rows[i].classList.toggle('selected', rows[i].dataset.id === _selected);
	}
	root.querySelector('.connect').disabled = !_selected || !!_opening;
}

/**
 * Ask the selected bot for a room of its own
 * @see docs/reference/network/remote-bot.md
 */
function open() {
	const settings = BotHall.loadSettings();
	const bot = BotHall.bots().find(b => b.id === _selected);
	const shown = _shown;

	if (!bot || _opening || !settings) {
		return;
	}

	_opening = bot.id;
	_failure = null;
	update();

	BotHall.open(bot.id).then(
		answer => {
			if (shown !== _shown) {
				return;
			}
			_opening = null;
			RemoteCharacters.onRoomOpened({
				relay: settings.relay,
				relayKey: settings.relayKey,
				room: answer.room,
				secret: answer.secret,
				character: bot.playing ? bot.playing.name : null
			});
		},
		err => {
			if (shown !== _shown) {
				return;
			}
			_opening = null;
			_failure = { id: bot.id, text: OPEN_FAILURES[err.code] || 'This remote client could not open a room.' };
			update();
		}
	);
}

/**
 * @param {string} text
 * @param {boolean} [error]
 * @return {HTMLElement}
 */
function message(text, error) {
	const node = document.createElement('div');

	node.className = error ? 'message error' : 'message';
	node.textContent = text;
	return node;
}

/**
 * @param {object} bot
 * @return {HTMLElement}
 */
function row(bot) {
	const node = document.createElement('div');
	const play = bot.playing;
	const parts = [
		['dot', bot.id === _opening ? '◷' : '●'],
		['name', play ? play.name : bot.account],
		['job', play ? `${MonsterTable[play.job] || ''} ${play.lv}`.trim() : 'not in game'],
		['map', play ? play.map : '']
	];

	node.className = bot.id === _selected ? 'bot selected' : 'bot';
	node.dataset.id = bot.id;
	for (let i = 0; i < parts.length; ++i) {
		const span = document.createElement('span');
		span.className = parts[i][0];
		span.textContent = parts[i][1];
		node.appendChild(span);
	}

	const sub = document.createElement('div');
	sub.className = 'sub';
	sub.textContent = `${bot.account} · ${bot.chars.length} character${bot.chars.length === 1 ? '' : 's'}`;
	node.appendChild(sub);

	const state = document.createElement('span');
	state.className = 'state';
	if (bot.id === _opening) {
		state.textContent = 'Opening…';
	} else if (_failure && _failure.id === bot.id) {
		state.textContent = _failure.text;
	} else if (bot.windows) {
		state.textContent = `${bot.windows} window${bot.windows === 1 ? '' : 's'} open`;
	}
	node.appendChild(state);

	node.addEventListener('mousedown', event => {
		select(bot);
		event.stopImmediatePropagation();
	});
	return node;
}

/**
 * Draw the list, or why there is none
 */
function update() {
	const root = RemoteCharacters.getRoot();
	const list = root && root.querySelector('.list');
	const state = BotHall.state();
	const bots = BotHall.bots();

	if (!list) {
		return;
	}

	if (_selected && !bots.some(bot => bot.id === _selected)) {
		_selected = null;
	}
	if (!_selected && bots.length) {
		_selected = bots[0].id;
	}

	list.textContent = '';
	if (state === 'joining') {
		list.appendChild(message('Entering the hall…'));
	} else if (state !== 'in') {
		list.appendChild(message(HALL_FAILURES[state] || `Cannot reach the relay (${state}).`, true));
	} else if (!bots.length && BotHall.waiting()) {
		list.appendChild(message('Calling the remote clients of the hall…'));
	} else if (!bots.length) {
		list.appendChild(
			message(
				'No remote client in this hall. Are your remote clients running with --spectate-rtc, and the same hall and secret?'
			)
		);
	} else {
		for (let i = 0; i < bots.length; ++i) {
			list.appendChild(row(bots[i]));
		}
	}

	mark();
}

/**
 * Stored component and return it
 */
export default UIManager.addComponent(RemoteCharacters);
