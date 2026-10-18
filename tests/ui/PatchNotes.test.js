import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	// Mirrors GUIComponent: the first append() renders and runs init(), every append() runs onAppend() then focus()
	class MockGUIComponent {
		constructor(name) {
			this.name = name;
			this.__active = false;
			this.needFocus = true;
		}

		getRoot() {
			return this._host;
		}

		append() {
			if (!this._host) {
				this._host = document.createElement('div');
				this._host.innerHTML = this.render();
				this.init?.();
			}
			this.__active = true;
			document.body.appendChild(this._host);
			this.onAppend?.();
			this.focus();
		}

		// Restacks every window that needs focus
		focus() {
			if (this.needFocus) {
				this._host.style.zIndex = '50';
			}
		}

		remove() {
			this.__active = false;
			this.onRemove?.();
			this._host?.remove();
		}

		draggable() {}
	}

	return { MockGUIComponent, config: {} };
});

vi.mock('Core/Configs.js', () => ({ default: { get: key => mocks.config[key] } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1280, height: 720 } }));
vi.mock('Controls/KeyEventHandler.js', () => ({ default: { ESCAPE: 27 } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));

const LOG = {
	releases: [
		{
			version: '0.1.0',
			date: '2026-10-18',
			title: 'The Plugin Update',
			sha: 'aaaaaaa1111111',
			notes: [
				{ type: 'new', keyword: 'Sell all', text: 'Your mouse can retire.', details: 'One click.' },
				{ type: 'fixed', keyword: 'Inventory', text: 'No more clones.', details: 'Count kept.' }
			]
		},
		{ version: '0.2.0', date: '2026-11-02', title: 'Second', sha: 'bbbbbbb2222222', notes: [] },
		{ version: '0.3.0', date: '2026-11-20', title: 'Third', sha: 'ccccccc3333333', notes: [] }
	]
};

const KEY = 'PatchNotes.seen.robrowser';

async function load(sha) {
	mocks.config = { patchNotes: { url: 'patchlog.json', product: 'robrowser', sha } };
	vi.resetModules();
	return (await import('UI/Components/PatchNotes/PatchNotes.js')).default;
}

function shownTitle(PatchNotes) {
	if (!PatchNotes.__active) {
		return null;
	}
	const head = PatchNotes.getRoot().querySelector('.head');
	return `${head.querySelector('.meta').textContent} - ${head.querySelector('.title').textContent}`;
}

describe('PatchNotes', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		localStorage.clear();
		globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(LOG) }));
	});

	afterEach(() => {
		delete globalThis.fetch;
	});

	it('stays inactive without ROConfig.patchNotes', async () => {
		mocks.config = {};
		vi.resetModules();
		const PatchNotes = (await import('UI/Components/PatchNotes/PatchNotes.js')).default;

		await PatchNotes.onLoginScreen();

		expect(PatchNotes.isEnabled()).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
		expect(PatchNotes.__active).toBe(false);
	});

	it('shows the version of the build sha', async () => {
		const PatchNotes = await load('bbbbbbb2222222');
		await PatchNotes.load();

		expect(PatchNotes.getVersionText()).toBe('robrowser 0.2.0');
	});

	it('shows the latest version for a build without a note, never the sha', async () => {
		const PatchNotes = await load('ddddddd');
		const el = document.createElement('span');
		PatchNotes.attachVersion(el);
		await PatchNotes.load();

		expect(el.textContent).toBe('robrowser 0.3.0');
		expect(el.style.display).toBe('');
	});

	it('does not pop on a first visit, and stores the version', async () => {
		const PatchNotes = await load('ccccccc3333333');
		await PatchNotes.onLoginScreen();

		expect(PatchNotes.__active).toBe(false);
		expect(localStorage.getItem(KEY)).toBe('0.3.0');
	});

	it('pops every version since the last seen one, newest first', async () => {
		localStorage.setItem(KEY, '0.1.0');
		const PatchNotes = await load('ccccccc3333333');
		await PatchNotes.onLoginScreen();

		expect(shownTitle(PatchNotes)).toBe('robrowser 0.3.0 \u00b7 November 20, 2026 - Third');
		expect(PatchNotes._host.style.zIndex).toBe('100');
		PatchNotes.getRoot().querySelector('.back').click();
		expect(shownTitle(PatchNotes)).toContain('0.2.0 \u00b7 November 2, 2026 - Second');
		expect(PatchNotes.getRoot().querySelector('.back').style.visibility).toBe('hidden');
		expect(localStorage.getItem(KEY)).toBe('0.3.0');
	});

	it('does not pop on the same version', async () => {
		localStorage.setItem(KEY, '0.3.0');
		const PatchNotes = await load('ccccccc3333333');
		await PatchNotes.onLoginScreen();

		expect(PatchNotes.__active).toBe(false);
	});

	it('does not pop on a rollback, and stores the running version', async () => {
		localStorage.setItem(KEY, '0.3.0');
		const PatchNotes = await load('aaaaaaa1111111');
		await PatchNotes.onLoginScreen();

		expect(PatchNotes.__active).toBe(false);
		expect(localStorage.getItem(KEY)).toBe('0.1.0');
	});

	it('opens on the running version from the version label, with keywords and details folded until clicked', async () => {
		const PatchNotes = await load('aaaaaaa1111111');
		const el = document.createElement('span');
		PatchNotes.attachVersion(el);
		await PatchNotes.load();
		el.click();

		const root = PatchNotes.getRoot();
		expect(shownTitle(PatchNotes)).toBe('robrowser 0.1.0 \u00b7 October 18, 2026 - The Plugin Update');
		expect([...root.querySelectorAll('.section')].map(s => s.textContent)).toEqual(['New', 'Fixed']);
		expect(root.querySelector('.head .count').textContent).toBe('1 new1 fixed');
		const row = root.querySelector('.row');
		expect(row.querySelector('.keyword').textContent).toBe('Sell all');
		expect(row.querySelector('.details').textContent).toBe('One click.');
		expect(row.classList.contains('open')).toBe(false);
		row.click();
		expect(row.classList.contains('open')).toBe(true);
		row.click();
		expect(row.classList.contains('open')).toBe(false);
		expect(root.querySelector('.back').style.visibility).toBe('hidden');

		root.querySelector('.next').click();
		expect(shownTitle(PatchNotes)).toContain('0.2.0');

		root.querySelector('.ok').click();
		expect(PatchNotes.__active).toBe(false);
	});
});
