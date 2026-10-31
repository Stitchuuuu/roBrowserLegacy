/**
 * UI/Components/BasicInfo/RemoteControlPill.js
 *
 * On a remote bot, the info window's title bar says whether this window plays the character; a click takes or gives
 * back the control
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import RemoteBot from 'Network/RemoteBot.js';
import ChatBox from 'UI/Components/ChatBox/ChatBox.js';
import cssText from './RemoteControlPill.css?raw';

/**
 * @var {Array<HTMLElement>} _pills - one per info window version built
 */
const _pills = [];

const RemoteControlPill = {};

/**
 * Put the pill in an info window's title bar, once
 *
 * @param {HTMLElement} topbar
 * @see docs/reference/network/remote-bot.md
 */
RemoteControlPill.attach = function attach(topbar) {
	if (topbar.querySelector('.remote-control')) {
		return;
	}

	const style = document.createElement('style');
	style.textContent = cssText;
	topbar.getRootNode().appendChild(style);

	const pill = document.createElement('button');
	pill.className = 'remote-control';
	// Not the title bar's drag
	pill.addEventListener('mousedown', event => event.stopImmediatePropagation());
	pill.addEventListener('click', () => {
		ChatBox.onRequestTalk('', RemoteBot.hasControl() ? '@control off' : '@control on', ChatBox.TYPE.PUBLIC);
	});
	topbar.appendChild(pill);
	_pills.push(pill);
	RemoteControlPill.refresh();
};

/**
 * Show the control the bot last said this window holds
 */
RemoteControlPill.refresh = function refresh() {
	const active = RemoteBot.isActive();
	const on = RemoteBot.hasControl();

	for (let i = 0; i < _pills.length; ++i) {
		const pill = _pills[i];
		pill.style.display = active ? '' : 'none';
		pill.classList.toggle('on', on);
		pill.textContent = on ? '● Control' : '○ Watching';
		pill.title = on
			? 'You play this character: click to give it back to the bot'
			: 'The bot plays: click to take control';
	}
};

/**
 * Export
 */
export default RemoteControlPill;
