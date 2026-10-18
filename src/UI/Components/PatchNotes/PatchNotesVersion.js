/**
 * UI/Components/PatchNotes/PatchNotesVersion.js
 *
 * Client version in the corner of the login screen
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import PatchNotes from './PatchNotes.js';
import cssText from './PatchNotesVersion.css?raw';

/**
 * Create Component
 */
const PatchNotesVersion = new GUIComponent('PatchNotesVersion', cssText);

PatchNotesVersion.render = () => '<div class="version"></div>';
PatchNotesVersion.needFocus = false;

/**
 * Initialize UI
 */
PatchNotesVersion.init = function init() {
	PatchNotes.attachVersion(this.getRoot().querySelector('.version'));
};

/**
 * Create component and export it
 */
export default UIManager.addComponent(PatchNotesVersion);
