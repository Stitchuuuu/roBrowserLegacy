/**
 * tests/plugins/PluginManagerUI.test.js
 *
 * plugin-manager-ui « Versions » choice: newest first with the installed one
 * marked, a newer pick installs in place, an older pick asks first and names
 * both versions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../plugins/plugin-manager-ui/plugin-manager-ui.esm.js';

const CDN = 'http://cdn.test/tab-target';
const url = v => `${CDN}/${v}/tab-target.di.esm.js`;

function row(installed) {
	return {
		name: 'tab-target',
		pluginName: 'TabTarget',
		version: installed,
		installed: true,
		enabled: true,
		debug: false,
		available: true,
		url: url('2.0.0'),
		registry: 'Community',
		updateAvailable: installed !== '2.0.0',
		status: 'ok',
		versions: ['2.0.0', '1.1.0', '1.0.0'].map(v => ({
			version: v,
			url: url(v),
			installed: v === installed,
			older: v < installed
		}))
	};
}

let panel;
let cleanups;
let LPM;

function mount(rows) {
	cleanups = [];
	LPM = {
		registries: () => [{ label: 'Community', url: 'http://registry.test/index.json' }],
		list: vi.fn(async () => rows),
		listInstalled: vi.fn(async () => rows),
		update: vi.fn(async () => ({ ok: true })),
		installFromUrl: vi.fn(async () => ({ ok: true })),
		onChange: () => () => {},
		addSubcommand: () => () => {}
	};
	class FakeComponent {
		getRoot() {
			return null;
		}
	}
	const ui = {
		registerPlayerWindow(factory, { onMount }) {
			const c = factory();
			panel = document.createElement('div');
			panel.innerHTML = c.render();
			document.body.appendChild(panel);
			onMount(panel);
			return { show() {}, hide() {}, toggle() {}, dispose() {} };
		},
		find: (p, sel) => p.querySelector(sel),
		on(p, sel, ev, fn) {
			const el = p.querySelector(sel);
			if (typeof ev === 'function') {
				el.addEventListener('click', ev);
			} else {
				el.addEventListener(ev, fn);
			}
		},
		root: p => p,
		makeDraggable() {}
	};
	plugin.init(null, {
		ui,
		icons: { injectIconCss() {} },
		lifecycle: { registerCleanup: fn => cleanups.push(fn) },
		LocalPluginManager: LPM,
		UIComponent: FakeComponent
	});
}

const flush = () => new Promise(r => setTimeout(r, 0));
const click = sel => panel.querySelector(sel).click();
const text = sel => panel.querySelector(sel).textContent.replace(/\s+/g, ' ').trim();

beforeEach(async () => {
	mount([row('1.1.0')]);
	await flush();
	click('[data-action="versions"]');
});

afterEach(() => {
	cleanups.forEach(fn => fn());
	panel.remove();
});

describe('plugin-manager-ui Versions', () => {
	it('lists the published versions newest first, the installed one marked', () => {
		const rows = [...panel.querySelectorAll('.pm-vrow')];
		expect(rows.map(r => r.querySelector('.pm-vnum').textContent)).toEqual(['v2.0.0', 'v1.1.0', 'v1.0.0']);
		expect(text('.pm-vrow.is-installed')).toBe('v1.1.0installed');
		expect(rows[1].querySelector('[data-action="pick-version"]')).toBeNull();
	});

	it('installs a newer version in place without asking', async () => {
		click('[data-action="pick-version"][data-version="2.0.0"]');
		await flush();
		expect(LPM.update).toHaveBeenCalledWith('tab-target', { sourceUrl: url('2.0.0'), version: '2.0.0' });
	});

	it('asks before an older version, naming both, then installs it in place', async () => {
		click('[data-action="pick-version"][data-version="1.0.0"]');
		expect(LPM.update).not.toHaveBeenCalled();
		expect(text('.pm-confirm span')).toBe('Replace v1.1.0 with the older v1.0.0?');

		click('[data-action="confirm-version"]');
		await flush();
		expect(LPM.update).toHaveBeenCalledWith('tab-target', { sourceUrl: url('1.0.0'), version: '1.0.0' });
		expect(LPM.installFromUrl).not.toHaveBeenCalled();
	});

	it('closes the list when the install fails', async () => {
		LPM.update.mockRejectedValueOnce(new Error('HTTP 404'));
		click('[data-action="pick-version"][data-version="2.0.0"]');
		await flush();
		expect(panel.querySelector('.pm-versions')).toBeNull();
		expect(text('.pm-status')).toBe('v2.0.0 failed: HTTP 404');
		click('[data-action="versions"]');
		expect(panel.querySelectorAll('.pm-vrow')).toHaveLength(3);
	});

	it('cancel goes back to the list without installing', () => {
		click('[data-action="pick-version"][data-version="1.0.0"]');
		click('[data-action="cancel-version"]');
		expect(panel.querySelector('.pm-confirm')).toBeNull();
		expect(panel.querySelectorAll('.pm-vrow')).toHaveLength(3);
		expect(LPM.update).not.toHaveBeenCalled();
	});
});

describe('plugin-manager-ui Update', () => {
	it('fetches the latest listed build, not the pinned installed one', async () => {
		click('[data-action="update"]');
		await flush();
		expect(LPM.update).toHaveBeenCalledWith('tab-target', { sourceUrl: url('2.0.0') });
	});

	it('re-fetches the stored source when nothing newer is listed', async () => {
		cleanups.forEach(fn => fn());
		panel.remove();
		mount([row('2.0.0')]);
		await flush();
		click('[data-action="update"]');
		await flush();
		expect(LPM.update).toHaveBeenCalledWith('tab-target', undefined);
	});
});
