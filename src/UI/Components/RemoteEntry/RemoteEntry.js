/**
 * UI/Components/RemoteEntry/RemoteEntry.js
 *
 * The login screen's way to the account's bots
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import 'UI/Elements/Elements.js';
import htmlText from './RemoteEntry.html?raw';
import cssText from './RemoteEntry.css?raw';

/**
 * Create component
 */
const RemoteEntry = new GUIComponent('RemoteEntry', cssText);

RemoteEntry.render = () => htmlText;

/**
 * Initialize UI: above the login window (see the CSS)
 */
RemoteEntry.init = function init() {
	this.getRoot()
		.querySelector('#RemoteEntry')
		.addEventListener('click', () => RemoteEntry.onRequest());
};

/**
 * Callback to define
 */
RemoteEntry.onRequest = function onRequest() {
	// Set by LoginEngine
};

/**
 * Stored component and return it
 */
export default UIManager.addComponent(RemoteEntry);
