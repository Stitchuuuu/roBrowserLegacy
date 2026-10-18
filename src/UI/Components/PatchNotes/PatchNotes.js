/**
 * UI/Components/PatchNotes/PatchNotes.js
 *
 * Patch notes window and client version
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import Configs from 'Core/Configs.js';
import Renderer from 'Renderer/Renderer.js';
import KEYS from 'Controls/KeyEventHandler.js';
import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import PatchLog from './PatchLog.js';
import 'UI/Elements/Elements.js';
import htmlText from './PatchNotes.html?raw';
import cssText from './PatchNotes.css?raw';

/**
 * Create Component
 */
const PatchNotes = new GUIComponent('PatchNotes', cssText);

PatchNotes.render = () => htmlText;

/**
 * @var {Promise|null} patch log request
 */
let _loading = null;

/**
 * @var {Array} releases of the patch log
 */
let _releases = [];

/**
 * @var {object|null} release of the running build
 */
let _current = null;

/**
 * @var {Array} releases shown, newest first
 */
let _pages = [];

/**
 * @var {number} page shown
 */
let _page = 0;

/**
 * Initialize UI
 */
PatchNotes.init = function init() {
	const root = this.getRoot();

	root.querySelector('.back').addEventListener('click', () => show(_page + 1));
	root.querySelector('.next').addEventListener('click', () => show(_page - 1));
	root.querySelector('.ok').addEventListener('click', () => this.remove());

	this.draggable(root.querySelector('.titlebar'));
};

/**
 * Center the window, as the official notice window
 */
PatchNotes.onAppend = function onAppend() {
	this._host.style.left = `${Math.max(0, (Renderer.width - 640) / 2 + 33)}px`;
	this._host.style.top = `${Math.max(0, (Renderer.height - 480) / 2 + 40)}px`;
};

/**
 * Close on Escape
 *
 * @param {object} event
 * @return {boolean}
 */
PatchNotes.onKeyDown = function onKeyDown(event) {
	if (event.which === KEYS.ESCAPE) {
		this.remove();
		event.stopImmediatePropagation();
		return false;
	}
	return true;
};

/**
 * @return {object|null} ROConfig.patchNotes
 */
function getConfig() {
	const config = Configs.get('patchNotes');
	return config && config.url ? config : null;
}

/**
 * @return {boolean} a patch log is configured
 */
PatchNotes.isEnabled = function isEnabled() {
	return !!getConfig();
};

/**
 * Load the patch log once
 *
 * @return {Promise}
 */
PatchNotes.load = function load() {
	const config = getConfig();

	if (!config) {
		return Promise.resolve();
	}

	if (!_loading) {
		_loading = fetch(config.url, { cache: 'no-cache' })
			.then(response => response.json())
			.then(log => {
				_releases = (log && log.releases) || [];
				_current = PatchLog.current(_releases, config.sha || '');
			})
			.catch(() => {
				_releases = [];
				_current = null;
			});
	}

	return _loading;
};

/**
 * Client version, as displayed
 *
 * @return {string} empty when unknown
 */
PatchNotes.getVersionText = function getVersionText() {
	const config = getConfig();

	if (!config || !_current) {
		return '';
	}

	return config.product ? `${config.product} ${_current.version}` : _current.version;
};

/**
 * Show the running version in an element, a click opens the notes
 *
 * @param {HTMLElement} element
 */
PatchNotes.attachVersion = function attachVersion(element) {
	element.style.display = 'none';
	element.addEventListener('click', () => {
		PatchNotes.open(PatchLog.sorted(_releases), _current);
	});

	PatchNotes.load().then(() => {
		const text = PatchNotes.getVersionText();
		element.textContent = text;
		element.style.display = text ? '' : 'none';
	});
};

/**
 * Open the window on a list of releases
 *
 * @param {Array} releases, newest first
 * @param {object} [release] shown first
 */
PatchNotes.open = function open(releases, release) {
	if (!releases.length) {
		return;
	}

	_pages = releases;
	if (!this.__active) {
		this.append();
	}
	show(Math.max(0, releases.indexOf(release)));
};

/**
 * Login screen is up: pop the notes of the versions not seen yet
 *
 * @return {Promise}
 */
PatchNotes.onLoginScreen = function onLoginScreen() {
	return PatchNotes.load().then(() => {
		if (!_current) {
			return;
		}

		const key = `PatchNotes.seen.${getConfig().product || ''}`;
		let seen = null;

		try {
			seen = localStorage.getItem(key);
			localStorage.setItem(key, _current.version);
		} catch (_e) {
			return;
		}

		const unseen = PatchLog.unseen(_releases, _current.version, seen);
		if (unseen.length) {
			PatchNotes.open(unseen);
		}
	});
};

/**
 * Display a page
 *
 * @param {number} page index in _pages
 */
function show(page) {
	if (page < 0 || page >= _pages.length) {
		return;
	}

	_page = page;

	const root = PatchNotes.getRoot();
	const content = root.querySelector('.content');
	content.replaceChildren(renderRelease(_pages[page]));
	content.scrollTop = 0;

	root.querySelector('.back').style.visibility = page < _pages.length - 1 ? '' : 'hidden';
	root.querySelector('.next').style.visibility = page > 0 ? '' : 'hidden';
}

/**
 * Build the DOM of a release
 *
 * @param {object} release
 * @return {HTMLElement}
 */
function renderRelease(release) {
	const config = getConfig() || {};
	const div = document.createElement('div');
	const head = document.createElement('div');
	const date = document.createElement('span');
	const sections = {};

	div.className = 'release';
	head.className = 'head';
	head.textContent = `${config.product ? config.product + ' ' : ''}${release.version} - ${release.title || ''} `;
	date.className = 'date';
	date.textContent = release.date || '';
	head.appendChild(date);
	div.appendChild(head);

	(release.notes || []).forEach(note => {
		const type = note.type || 'new';

		if (!sections[type]) {
			const title = document.createElement('div');
			title.className = 'section';
			title.textContent = type === 'fixed' ? 'Fixed' : 'New';
			sections[type] = document.createElement('ul');
			div.appendChild(title);
			div.appendChild(sections[type]);
		}

		sections[type].appendChild(renderNote(note));
	});

	return div;
}

/**
 * Build the DOM of a note: bold keyword, text, folded details
 *
 * @param {object} note
 * @return {HTMLElement}
 */
function renderNote(note) {
	const li = document.createElement('li');
	const keyword = document.createElement('b');

	keyword.textContent = note.keyword || '';
	li.appendChild(keyword);
	li.appendChild(document.createTextNode(` - ${note.text || ''}`));

	if (note.details) {
		const details = document.createElement('details');
		const summary = document.createElement('summary');
		const text = document.createElement('div');

		summary.textContent = 'Details';
		text.textContent = note.details;
		details.appendChild(summary);
		details.appendChild(text);
		li.appendChild(details);
	}

	return li;
}

/**
 * Create component and export it
 */
export default UIManager.addComponent(PatchNotes);
