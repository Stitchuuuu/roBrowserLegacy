/**
 * Engine/MapEngine/RemoteBotChat.js
 *
 * A remote bot's slash commands and its log, in the chat
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import RemoteBot from 'Network/RemoteBot.js';
import Commands from 'Controls/ProcessCommand.js';
import ChatBox from 'UI/Components/ChatBox/ChatBox.js';
import ChatBoxSettings from 'UI/Components/ChatBoxSettings/ChatBoxSettings.js';

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
 * Initialize
 */
export default function RemoteBotChatEngine() {
	RemoteBot.onText(onText);
}
