/**
 * Network/CameraTile.js
 *
 * A tile of the camera page (api.html#camera in its iframe): watches the bot whose room the page posts
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Configs from 'Core/Configs.js';
import AudioPrefs from 'Preferences/Audio.js';
import GraphicsSettings from 'Preferences/Graphics.js';

/**
 * What « Scene only » leaves on the page: every other child of body (each window's host) is hidden
 * @const {Array<string>}
 */
export const SCENE_KEEP = ['canvas.ro-scene', '.entity-overlay', '.cursor'];

/**
 * What « Scene only » hides among the labels drawn over the scene: names and chat bubbles; the life bars stay
 * @const {Array<string>}
 */
export const SCENE_HIDE_OVERLAY = ['.entity-display', '.entity-dialog'];

/**
 * @return {boolean} #camera in a frame of a page of this origin
 */
function isTile() {
	if (!new URLSearchParams(window.location.hash.slice(1)).has('camera')) {
		return false;
	}
	try {
		return window.parent !== window && window.parent.location.origin === window.location.origin;
	} catch (_e) {
		return false;
	}
}

/**
 * The CSS of « Scene only », a class on body
 *
 * @return {string}
 */
export function sceneRule() {
	const keep = SCENE_KEEP.map(selector => `:not(${selector})`).join('');
	let css = `body.scene-only > *${keep} { display: none !important; }`;

	if (SCENE_HIDE_OVERLAY.length) {
		css += `\nbody.scene-only .entity-overlay > :is(${SCENE_HIDE_OVERLAY.join(', ')}) { display: none !important; }`;
	}
	return css;
}

const CameraTile = {
	active: isTile()
};

/**
 * @var {?function(object)} _attach - takes the room the camera page posts, once
 */
let _attach = null;

/**
 * Ready for a room: the camera page asks the bot for one now, so the bot's fresh room never waits for a
 * window still loading
 *
 * @param {function({relay: string, relayKey: string, room: string, secret: string, character: ?string})} attach
 */
CameraTile.wait = function wait(attach) {
	_attach = attach;
	window.parent.postMessage({ t: 'camera-ready' }, window.location.origin);
};

/**
 * The room, from the camera page only
 *
 * @param {MessageEvent} event
 */
function onMessage(event) {
	const attach = _attach;

	if (!attach || event.source !== window.parent || event.origin !== window.location.origin) {
		return;
	}
	if (event.data && event.data.t === 'camera-room' && event.data.room) {
		_attach = null;
		attach(event.data.room);
	}
}

/**
 * N tiles share the page's thread and the localStorage of every tab: lighter settings, in memory only
 */
function apply() {
	const style = document.createElement('style');

	AudioPrefs.BGM.play = false;
	AudioPrefs.Sound.play = false;
	GraphicsSettings.fpslimit = 15;
	GraphicsSettings.fades = false;
	Configs.set('quality', 50);

	style.textContent = sceneRule();
	document.head.appendChild(style);
	window.addEventListener('message', onMessage);
}

if (CameraTile.active) {
	apply();
}

/**
 * Export
 */
export default CameraTile;
