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

// Keeps its z-index: focus() would put it back under the login window
PatchNotes.needFocus = false;

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
 * @var {Array} sections of a release, in display order
 */
const SECTIONS = [
	{ type: 'new', label: 'New', icon: 'basic_interface/icon_new.bmp' },
	{ type: 'fixed', label: 'Fixed', icon: 'item/bs_repairweapon.bmp' }
];

/**
 * @var {Array} month names, for the release date
 */
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/**
 * Initialize UI
 */
PatchNotes.init = function init() {
	const root = this.getRoot();

	root.querySelector('.back').addEventListener('click', () => show(_page + 1));
	root.querySelector('.next').addEventListener('click', () => show(_page - 1));
	root.querySelector('.ok').addEventListener('click', () => this.remove());
	root.querySelector('.content').addEventListener('click', event => {
		const row = event.target.closest('.row.foldable');
		if (row) {
			row.classList.toggle('open');
		}
	});

	this.draggable(root.querySelector('.titlebar'));
};

/**
 * Center the window, as the official notice window, above the login window
 */
PatchNotes.onAppend = function onAppend() {
	this._host.style.left = `${Math.max(0, (Renderer.width - 640) / 2 + 33)}px`;
	this._host.style.top = `${Math.max(0, (Renderer.height - 480) / 2 + 40)}px`;
	this._host.style.zIndex = '100';
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
	const release = _pages[page];
	const config = getConfig() || {};
	const notes = release.notes || [];
	const content = root.querySelector('.content');

	root.querySelector('.head .title').textContent = release.title || '';
	root.querySelector('.head .meta').textContent = [
		`${config.product ? config.product + ' ' : ''}${release.version}`,
		formatDate(release.date)
	]
		.filter(Boolean)
		.join(' \u00b7 ');
	root.querySelector('.head .count').replaceChildren(
		...SECTIONS.flatMap(section => {
			const count = notes.filter(note => (note.type || 'new') === section.type).length;
			return count ? [create('b', '', count), ` ${section.type}`, create('br')] : [];
		})
	);

	content.replaceChildren(...SECTIONS.flatMap(section => renderSection(section, notes)));
	content.scrollTop = 0;

	root.querySelector('.back').style.visibility = page < _pages.length - 1 ? '' : 'hidden';
	root.querySelector('.next').style.visibility = page > 0 ? '' : 'hidden';
}

/**
 * @param {string} date YYYY-MM-DD
 * @return {string} October 18, 2026
 */
function formatDate(date) {
	const parts = String(date || '').split('-');
	return parts.length === 3 ? `${MONTHS[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}, ${parts[0]}` : '';
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string|number} [text]
 * @return {HTMLElement}
 */
function create(tag, className, text) {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

/**
 * @param {string} className
 * @param {string} src interface image
 * @return {HTMLElement} element painted with the image
 */
function image(className, src) {
	const element = create('div', className);
	const img = create('ui-image');
	img.setAttribute('src', src);
	element.appendChild(img);
	return element;
}

/**
 * Build a section: title, then a row per note
 *
 * @param {object} section of SECTIONS
 * @param {Array} notes of the release
 * @return {Array} elements, empty when the section has no note
 */
function renderSection(section, notes) {
	const list = notes.filter(note => (note.type || 'new') === section.type);

	if (!list.length) {
		return [];
	}

	const title = create('div', `section ${section.type}`);
	const rows = create('div', 'rows');

	title.appendChild(image('icon', section.icon));
	title.appendChild(document.createTextNode(section.label));
	list.forEach(note => rows.appendChild(renderNote(note)));

	return [title, rows];
}

/**
 * Build a note: keyword, text, details folded until the row is clicked
 *
 * @param {object} note
 * @return {HTMLElement}
 */
function renderNote(note) {
	const row = create('div', 'row');

	row.appendChild(create('span', 'keyword', note.keyword || ''));
	row.appendChild(document.createTextNode(`  ${note.text || ''}`));

	if (note.details) {
		row.classList.add('foldable');
		row.appendChild(image('fold closed', 'basic_interface/folder_c.bmp'));
		row.appendChild(image('fold open', 'basic_interface/folder_o.bmp'));
		row.appendChild(create('div', 'details', note.details));
	}

	return row;
}

/**
 * Create component and export it
 */
export default UIManager.addComponent(PatchNotes);
