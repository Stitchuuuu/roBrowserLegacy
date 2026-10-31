/**
 * Engine/MapEngine/RemoteBotChat.js
 *
 * A remote bot's slash commands and its log, in the chat; its control taken after a switch
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import RemoteBot from 'Network/RemoteBot.js';
import BotHall from 'Network/BotHall.js';
import Session from 'Engine/SessionStorage.js';
import MapRenderer from 'Renderer/MapRenderer.js';
import Commands from 'Controls/ProcessCommand.js';
import ChatBox from 'UI/Components/ChatBox/ChatBox.js';
import ChatBoxSettings from 'UI/Components/ChatBoxSettings/ChatBoxSettings.js';
import Escape from 'UI/Components/Escape/Escape.js';

/**
 * Why 'Control' did not switch, by BotHall.open() error code
 * @const {object}
 */
const CONTROL_FAILURES = {
	busy: 'this remote client has too many windows open.',
	gone: 'this remote client left the hall.',
	'no-answer': 'this remote client did not answer.'
};

/**
 * @var {boolean} _opening - a 'Control' waits for the other bot's room
 */
let _opening = false;

/**
 * @var {Array<string>} _added - the commands this module put in the chat
 */
let _added = [];

/**
 * @var {boolean} _log - the bot sends its log
 */
let _log = false;

/**
 * Take the bot's commands out of the chat
 */
function clear() {
	for (let i = 0; i < _added.length; ++i) {
		Commands.remove(_added[i]);
	}
	_added = [];
	_log = false;
}

/**
 * A bot command typed in the chat: the bot runs it in its console
 *
 * @param {string} text - the line without its slash
 */
function runOnBot(text) {
	ChatBox.onRequestTalk('', '@@' + text, ChatBox.TYPE.PUBLIC);
}

/**
 * /log: the bot's log in the chat, or not any more
 */
function toggleLog() {
	_log = !_log;

	if (!RemoteBot.sendText({ t: 'log', v: 1, on: _log })) {
		_log = false;
		ChatBox.addText('Bot log: the bot cannot be reached.', ChatBox.TYPE.ERROR, ChatBox.FILTER.PUBLIC_LOG);
		return;
	}

	if (!_log) {
		ChatBox.addText('Bot log: off.', ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
		return;
	}

	// Lines no tab shows would go nowhere: this tab shows them
	const options = ChatBoxSettings.tabOption;
	if (!options.some(list => list && list.includes(ChatBox.FILTER.BOT_LOG))) {
		options[ChatBox.activeTab] = options[ChatBox.activeTab] || [];
		options[ChatBox.activeTab].push(ChatBox.FILTER.BOT_LOG);
	}
	ChatBox.addText('Bot log: on. /log again to stop it.', ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
}

/**
 * A text message from the bot
 *
 * @param {?object} message - null when the bot's peer left
 * @see docs/reference/network/remote-bot.md
 */
function onText(message) {
	if (!message) {
		clear();
		Escape.refreshCharSelect();
		return;
	}

	if (message.t === 'control') {
		Escape.refreshCharSelect();
		return;
	}

	if (message.t === 'cmds' && Array.isArray(message.list)) {
		clear();
		message.list.forEach(cmd => {
			const names = [cmd.name].concat(Array.isArray(cmd.aliases) ? cmd.aliases : []);

			names.forEach(name => {
				// The client's own command keeps its name; @@<name> still reaches the bot
				if (typeof name !== 'string' || !/^[\w-]+$/.test(name) || Commands.exists(name)) {
					return;
				}
				Commands.add(name, typeof cmd.help === 'string' ? cmd.help : '', runOnBot);
				_added.push(name);
			});
		});
		if (!Commands.exists('log')) {
			Commands.add('log', "show the bot's log in the chat", toggleLog);
			_added.push('log');
		}
		// The bot says it once the window is in game: a switch takes its control then
		if (RemoteBot.takeWantControl()) {
			ChatBox.onRequestTalk('', '@control on', ChatBox.TYPE.PUBLIC);
		}
		return;
	}

	if (message.t === 'log' && Array.isArray(message.lines) && _log) {
		message.lines.forEach(line => {
			if (typeof line === 'string') {
				ChatBox.addText(line, ChatBox.TYPE.INFO, ChatBox.FILTER.BOT_LOG);
			}
		});
	}
}

/**
 * Another remote client of the hall plays this character here: 'Control' in its context menu
 *
 * @param {string} name - a character on the map
 * @return {?object} the bot's hall row, null for anyone else and for this window's own bot
 * @see docs/reference/network/remote-bot.md
 */
export function controllable(name) {
	if (!RemoteBot.isActive() || name === Session.Entity.display.name) {
		return null;
	}
	return BotHall.playing(name, MapRenderer.currentMap.replace(/\.[^.]*$/, ''));
}

/**
 * 'Control': the other bot opens a room, this window lets go of its bot (as Exit does) and plays the other one
 *
 * @param {string} name - a controllable() character
 * @see docs/reference/network/remote-bot.md
 */
export function takeControl(name) {
	const bot = controllable(name);
	const settings = BotHall.loadSettings();
	// An answer that comes once this character left the map is no use
	const entity = Session.Entity;

	if (_opening) {
		return;
	}
	if (!bot || !settings) {
		ChatBox.addText('Control: ' + CONTROL_FAILURES.gone, ChatBox.TYPE.ERROR, ChatBox.FILTER.PUBLIC_LOG);
		return;
	}

	_opening = true;
	BotHall.open(bot.id).then(
		answer => {
			_opening = false;
			const room = { ...settings, room: answer.room, secret: answer.secret, character: name };

			if (Session.Entity === entity && RemoteBot.switchTo(room)) {
				Escape.onExitRequest();
			}
		},
		err => {
			_opening = false;
			if (Session.Entity === entity) {
				const why = CONTROL_FAILURES[err.code] || 'this remote client could not open a room.';
				ChatBox.addText('Control: ' + why, ChatBox.TYPE.ERROR, ChatBox.FILTER.PUBLIC_LOG);
			}
		}
	);
}

/**
 * Initialize
 */
export default function RemoteBotChatEngine() {
	RemoteBot.onText(onText);
}
