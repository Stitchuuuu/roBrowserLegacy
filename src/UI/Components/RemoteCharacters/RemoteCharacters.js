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
import RemoteBot from 'Network/RemoteBot.js';
import AutoRetry from 'Engine/AutoRetry.js';
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
 * @var {string} _search - the search field, trimmed and lower case
 */
let _search = '';

/**
 * @var {?string} _controlAccount - #control=<account> (the camera page's Control): opened with its control once listed
 */
let _controlAccount = takeControlHash();

/**
 * @var {?{account: string, control: boolean, id: ?string, gone: boolean, fresh: boolean}} _waitFor - auto-retry:
 *   the bot opened again once it plays. id: its peer when first seen; gone: seen out of the game (a list kept
 *   from before the drop may still say it plays); fresh: another process of it, which may take its time to log in
 */
let _waitFor = null;

/**
 * @var {?{account: string, character: ?string, ready: boolean}} _retry - auto-retry: the bot whose character is
 *   picked again, ready once its failure box is gone
 */
let _retry = null;

/**
 * @var {number} _retryTimer - the failure box shown before the pick is tried again
 */
let _retryTimer = 0;

/**
 * Initialize UI
 */
RemoteCharacters.init = function init() {
	const root = this.getRoot();
	const search = root.querySelector('.search');

	this._host.style.top = `${(Renderer.height - 222) / 1.5}px`;
	this._host.style.left = `${(Renderer.width - 280) / 2}px`;
	this.draggable(root.querySelector('.titlebar'));

	root.querySelector('.settings').addEventListener('click', () => RemoteCharacters.requestSettings());
	root.querySelector('.login').addEventListener('click', () => RemoteCharacters.requestLogin());
	root.querySelector('.connect').addEventListener('click', () => open());
	root.querySelector('.autoretry-check').addEventListener('change', function onChange() {
		AutoRetry.setEnabled(this.checked);
		if (!this.checked) {
			stopWaiting();
		}
	});
	root.querySelector('.autoretry-check').addEventListener('mousedown', event => {
		event.stopImmediatePropagation();
	});
	search.addEventListener('input', () => {
		_search = search.value.trim().toLowerCase();
		update();
	});
	// Enter, up and down go on to onKeyDown: the rest is typing
	search.addEventListener('keydown', event => {
		if (event.which !== KEYS.ENTER && event.which !== KEYS.UP && event.which !== KEYS.DOWN) {
			event.stopPropagation();
		}
	});
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
	const drop = RemoteBot.takeDrop();

	_selected = null;
	_opening = null;
	_failure = null;
	_search = '';
	this.getRoot().querySelector('.search').value = '';
	this.getRoot().querySelector('.autoretry-check').checked = AutoRetry.isEnabled();
	stopWaiting(!!drop && drop.repick);
	if (drop && drop.repick) {
		retryPick(drop);
	} else if (drop) {
		_waitFor = { account: drop.account, control: drop.control, id: null, gone: false, fresh: false };
	}
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
	if (_retryTimer) {
		clearTimeout(_retryTimer);
		_retryTimer = 0;
	}
};

/**
 * Key Management
 *
 * @param {object} event
 * @return {boolean}
 */
RemoteCharacters.onKeyDown = function onKeyDown(event) {
	const bots = filter(BotHall.bots());
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
RemoteCharacters.requestSettings = function requestSettings() {
	stopWaiting();
	RemoteCharacters.onSettingsRequest();
};
RemoteCharacters.requestLogin = function requestLogin() {
	stopWaiting();
	RemoteCharacters.onLoginRequest();
};
RemoteCharacters.onRoomOpened = function onRoomOpened() {
	// Set by LoginEngine
};

/**
 * @param {string} text
 * @return {boolean} the search is in it
 */
function matches(text) {
	return !!_search && text.toLowerCase().includes(_search);
}

/**
 * @param {Array<object>} bots
 * @return {Array<object>} the bots whose account or one character matches the search
 */
function filter(bots) {
	if (!_search) {
		return bots;
	}
	return bots.filter(bot => matches(bot.account) || bot.chars.some(char => matches(char.name)));
}

/**
 * @param {?object} bot
 */
function select(bot) {
	if (bot && !_opening) {
		_selected = bot.id;
		if (_waitFor && _waitFor.account !== bot.account) {
			stopWaiting();
			update();
			return;
		}
		mark();
	}
}

/**
 * Auto-retry gives up: no bot waited for, no character picked again
 *
 * @param {boolean} [keepRun] - the pick about to be tried again keeps its attempt count
 */
function stopWaiting(keepRun = false) {
	_waitFor = null;
	_retry = null;
	if (_retryTimer) {
		clearTimeout(_retryTimer);
		_retryTimer = 0;
	}
	if (!keepRun) {
		RemoteBot.stopRetry();
	}
}

/**
 * The bot could not log in with the character picked, for a while: say why, as the login window does, then
 * open it again and pick the same character. OK on the box stops there.
 *
 * @param {{account: string, character: ?string, why: string}} drop
 */
function retryPick(drop) {
	_retry = { account: drop.account, character: drop.character, ready: false };

	const box = UIManager.showMessageBox(
		`Remote client: ${drop.why || 'the login failed'}.`,
		'ok',
		() => {
			stopWaiting();
			update();
		},
		true
	);

	_retryTimer = setTimeout(() => {
		_retryTimer = 0;
		box.remove();
		_retry.ready = true;
		update();
	}, AutoRetry.MIN_GAP);
}

/**
 * Open the bot auto-retry waits for, once it plays again; let it go once it is out of the game for good
 *
 * @param {Array<object>} bots
 */
function takeWaited(bots) {
	const bot = _waitFor && bots.find(b => b.account === _waitFor.account);

	if (!bot || _opening) {
		return;
	}
	if (bot.id !== _waitFor.id) {
		// A later process of the same bot (restarted) has no list from before the drop
		if (_waitFor.id) {
			_waitFor.gone = true;
			_waitFor.fresh = true;
		}
		_waitFor.id = bot.id;
	}
	if (bot.playing) {
		if (_waitFor.gone) {
			const control = _waitFor.control;

			_waitFor = null;
			_selected = bot.id;
			open(control);
		}
		return;
	}
	_waitFor.gone = true;
	// Parked (Disconnect & Exit, or its reconnect loop gave up): nothing brings it back by itself
	if (!bot.reconnecting && !_waitFor.fresh) {
		_waitFor = null;
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
 *
 * @param {boolean} [control] - take its control once in game
 * @param {?string} [pick] - auto-retry: the character to pick (null: the player picks); by hand when omitted
 * @see docs/reference/network/remote-bot.md
 */
function open(control = false, pick) {
	const settings = BotHall.loadSettings();
	const bot = BotHall.bots().find(b => b.id === _selected);
	const shown = _shown;

	if (!bot || _opening || !settings) {
		return;
	}
	if (pick === undefined) {
		// By hand: another bot ends an auto-retry run
		stopWaiting();
	}
	if (bot.reconnecting && !bot.playing) {
		// Its cached character select would fight its own reconnect: open it once it plays
		_waitFor = { account: bot.account, control, id: bot.id, gone: true, fresh: false };
		update();
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
				account: bot.account,
				character: pick !== undefined ? pick : bot.playing ? bot.playing.name : null,
				control
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
 * @param {object} char - {name, job, lv}
 * @param {?object} play - the character the bot plays
 * @return {HTMLElement}
 */
function character(char, play) {
	const node = document.createElement('span');
	const job = document.createElement('span');

	node.className = 'char';
	node.classList.toggle('playing', !!play && play.name === char.name);
	node.classList.toggle('match', matches(char.name));
	node.textContent = char.name;
	job.className = 'job';
	job.textContent = `${MonsterTable[char.job] || ''} ${char.lv}`.trim();
	node.appendChild(job);
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
		['name', bot.account],
		['map', play ? play.map : 'not in game']
	];

	node.className = bot.id === _selected ? 'bot selected' : 'bot';
	node.dataset.id = bot.id;
	for (let i = 0; i < parts.length; ++i) {
		const span = document.createElement('span');
		span.className = parts[i][0];
		span.textContent = parts[i][1];
		node.appendChild(span);
	}

	const chars = document.createElement('div');
	chars.className = 'chars';
	for (let i = 0; i < bot.chars.length; ++i) {
		chars.appendChild(character(bot.chars[i], play));
	}
	node.appendChild(chars);

	const state = document.createElement('div');
	state.className = 'state';
	if (bot.id === _opening) {
		state.textContent = 'Opening…';
	} else if (_retry && _retry.account === bot.account) {
		state.textContent = `Retrying… (attempt ${RemoteBot.attempt()})`;
	} else if (_waitFor && _waitFor.account === bot.account) {
		state.textContent = bot.reconnecting
			? 'Reconnecting to the server… opened once it plays again.'
			: 'Waiting for it to be back in game…';
	} else if (bot.reconnecting && !play) {
		state.textContent = 'Reconnecting to the server…';
	} else if (_failure && _failure.id === bot.id) {
		state.textContent = _failure.text;
	} else if (bot.windows) {
		state.textContent = `${bot.windows} window${bot.windows === 1 ? '' : 's'} open`;
	}
	if (state.textContent) {
		node.appendChild(state);
	}

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
	const rows = filter(bots);

	if (!list) {
		return;
	}
	// Before the rows: a wait it ends shows on them at once
	takeWaited(bots);

	if (_selected && !rows.some(bot => bot.id === _selected)) {
		_selected = null;
	}
	if (!_selected && rows.length) {
		_selected = rows[0].id;
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
	} else if (!rows.length) {
		list.appendChild(message('No account or character matches this search.'));
	} else {
		for (let i = 0; i < rows.length; ++i) {
			list.appendChild(row(rows[i]));
		}
	}

	mark();

	const retried = _retry && _retry.ready && !_opening && bots.find(bot => bot.account === _retry.account);

	if (retried) {
		const pick = _retry.character;

		_retry = null;
		_selected = retried.id;
		open(false, pick);
	}

	const wanted = _controlAccount && bots.find(bot => bot.account === _controlAccount);

	if (wanted && !_opening) {
		_controlAccount = null;
		_selected = wanted.id;
		open(true);
	}
}

/**
 * #control=<account>, once: the address bar keeps no order
 *
 * @return {?string}
 */
function takeControlHash() {
	const account = new URLSearchParams(window.location.hash.slice(1)).get('control');

	if (account) {
		history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
	}
	return account || null;
}

/**
 * Stored component and return it
 */
export default UIManager.addComponent(RemoteCharacters);
