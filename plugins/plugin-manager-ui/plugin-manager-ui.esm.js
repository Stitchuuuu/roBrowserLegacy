/**
 * plugin-manager-ui — a thin UI reflection of LocalPluginManager (LPM).
 *
 * Hand-authored ESM (zero imports, pure DI). A draggable Shadow-DOM window
 * (native GUIComponent) that lists the installed plugins and delegates EVERY
 * action to `deps.LocalPluginManager` — the UI holds NO store logic.
 *   - `ui.registerPlayerWindow` — mount + reassert across map cycles (subsumes
 *     the v3 lib's hand-rolled reassert()); preserves user-toggled visibility.
 *   - Alt+Shift+P            — toggle the window (composedPath for shadow retarget).
 *   - `icons.injectIconCss`  — Lucide icons inside the component's shadow root.
 *   - `LPM.onChange`         — re-render rows after every mutation; unsubscribed
 *                              in a `registerCleanup`.
 *   - graceful degrade       — LPM absent → "not loaded" line, no crash.
 *
 * Ported from robrowser/tools/v3/libs/plugin-manager-ui (old UIComponent → the
 * native Shadow-DOM GUIComponent). Data source = `LPM.list()` when registries
 * are configured (installed rows merged with installable registry rows and
 * update badges), else `listInstalled()` (IndexedDB only). Install goes through
 * a registry row, the URL field (registries only) or the upload button
 * (`installFromFile`). Drag-drop install is owned by LPM itself (document
 * capture-phase), not this UI.
 *
 * Wire it via ROConfig.plugins as `/plugins/plugin-manager-ui/plugin-manager-ui.esm.js`.
 */

const VERSION = '0.1.0';

const CSS = `
.pm-panel { width: 380px; background: rgba(20,30,50,0.94); border: 1px solid #4af; border-radius: 4px; color: #fff; font-family: Arial, sans-serif; font-size: 11px; text-shadow: 1px 1px 0 #000; box-shadow: 0 2px 10px rgba(0,0,0,0.7); display: flex; flex-direction: column; }
.pm-header { background: linear-gradient(180deg, #4af, #26a); padding: 4px 6px 4px 8px; font-weight: bold; border-radius: 3px 3px 0 0; user-select: none; display: flex; align-items: center; flex: 0 0 auto; cursor: move; }
.pm-title { flex: 1; }
.pm-version { font-size: 9px; opacity: 0.7; font-weight: normal; margin-left: 4px; }
.pm-win-btn { width: 22px; height: 20px; padding: 0; margin-left: 4px; border-radius: 2px; background: rgba(40,60,100,0.9); border: 1px solid #4af; color: #fff; font: bold 14px inherit; line-height: 1; cursor: pointer; text-shadow: 1px 1px 0 #000; transition: background 80ms, border-color 80ms; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; vertical-align: middle; }
.pm-win-btn:hover { background: rgba(80,140,220,0.95); border-color: #7cf; }
.pm-close:hover { background: rgba(200,60,60,0.95); border-color: #e88; }
.pm-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.pm-status { color: #ad6; font-size: 10px; min-height: 13px; }
.pm-install { display: flex; align-items: center; gap: 6px; }
.pm-search-wrap { flex: 1; min-width: 0; position: relative; display: flex; align-items: center; }
.pm-search-ico { position: absolute; left: 6px; font-size: 13px; color: #9ab; pointer-events: none; }
.pm-url, .pm-search { flex: 1; min-width: 0; background: rgba(0,0,0,0.4); border: 1px solid #4af; border-radius: 3px; color: #fff; font: 11px inherit; padding: 3px 6px; outline: none; }
.pm-search { padding-left: 24px; }
.pm-url::placeholder, .pm-search::placeholder { color: #9ab; }
.pm-url:focus, .pm-search:focus { border-color: #7cf; }
.pm-install-btn, .pm-upload-btn { flex: 0 0 auto; background: rgba(40,60,100,0.9); border: 1px solid #4af; color: #fff; font: bold 14px inherit; line-height: 1; padding: 3px 8px; border-radius: 2px; cursor: pointer; text-shadow: 1px 1px 0 #000; display: inline-flex; align-items: center; }
.pm-install-btn:hover, .pm-upload-btn:hover { background: rgba(80,140,220,0.95); border-color: #7cf; }
.pm-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(74,170,255,0.5) rgba(40,60,100,0.3); }
.pm-list::-webkit-scrollbar { width: 8px; }
.pm-list::-webkit-scrollbar-track { background: rgba(40,60,100,0.3); border-radius: 4px; }
.pm-list::-webkit-scrollbar-thumb { background: rgba(74,170,255,0.5); border-radius: 4px; }
.pm-list::-webkit-scrollbar-thumb:hover { background: rgba(74,170,255,0.8); }
.pm-empty { color: #aaa; font-style: italic; padding: 6px; text-align: center; }
.pm-row { background: rgba(0,0,0,0.4); border-left: 3px solid #4af; border-radius: 2px; padding: 5px 7px; display: flex; flex-direction: column; gap: 4px; }
.pm-row.is-disabled { border-left-color: #678; opacity: 0.75; }
.pm-row-main { display: flex; align-items: baseline; gap: 6px; }
.pm-name { font-weight: bold; }
.pm-slug { color: #9ab; font-size: 9px; }
.pm-ver { margin-left: auto; color: #ad6; font-size: 10px; }
.pm-badges { display: flex; flex-wrap: wrap; gap: 4px; }
.pm-badge { font-size: 9px; padding: 1px 5px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); color: #99a; background: rgba(255,255,255,0.05); }
.pm-badge.on { color: #fff; border-color: #6c6; background: rgba(60,160,60,0.45); }
.pm-badge.dbg { color: #fc6; border-color: #b83; background: rgba(180,120,40,0.4); }
.pm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.pm-btn { background: rgba(40,60,100,0.9); border: 1px solid #4af; color: #fff; font: 10px inherit; padding: 3px 8px; border-radius: 2px; cursor: pointer; text-shadow: 1px 1px 0 #000; }
.pm-btn:hover { background: rgba(80,140,220,0.95); border-color: #7cf; }
.pm-btn-icon { font-size: 14px; line-height: 1; padding: 3px 7px; }
.pm-btn[data-action="uninstall"]:hover { background: rgba(200,60,60,0.9); border-color: #e88; }
.pm-btn:disabled { opacity: 0.5; cursor: default; }
.pm-enable-wrap { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; color: #9cf; font-size: 10px; cursor: pointer; user-select: none; }
.pm-enable-wrap input { width: 13px; height: 13px; accent-color: #4af; cursor: pointer; margin: 0; }
.pm-badge.upd { color: #cfa; border-color: #6a4; background: rgba(120,180,60,0.4); }
.pm-badge.reg { color: #9cf; border-color: #47a; background: rgba(60,100,160,0.35); }
.pm-row.is-registry { border-left-color: #6c6; }
`;

const HTML = `
<div class="pm-panel">
	<div class="pm-header">
		<span class="pm-title">Plugin Manager <span class="pm-version">v${VERSION}</span></span>
		<button type="button" class="pm-win-btn pm-refresh" title="Refresh"><span class="ro-icon ro-icon-rotate-cw"></span></button>
		<button type="button" class="pm-win-btn pm-close" title="Close"><span class="ro-icon ro-icon-x"></span></button>
	</div>
	<div class="pm-body">
		<div class="pm-status">Loading…</div>
		<div class="pm-install">
			<input type="text" class="pm-url" placeholder="https://…/plugin.esm.js" autocomplete="off" spellcheck="false">
			<button type="button" class="pm-install-btn" title="Install from URL"><span class="ro-icon ro-icon-download"></span></button>
			<button type="button" class="pm-upload-btn" title="Install from file"><span class="ro-icon ro-icon-upload"></span></button>
		</div>
		<div class="pm-search-wrap">
			<span class="ro-icon ro-icon-search pm-search-ico"></span>
			<input type="text" class="pm-search" placeholder="Search plugins…" autocomplete="off" spellcheck="false">
		</div>
		<div class="pm-list"></div>
	</div>
</div>
`.trim();

function escapeHtml(s) {
	return String(s == null ? '' : s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** A registry-only row (listed but not installed): name/version/registry + Install. */
function registryRowHtml(p) {
	const friendly = p.pluginName || p.name;
	return `
<div class="pm-row is-registry" data-name="${escapeHtml(p.name)}" data-url="${escapeHtml(p.url || '')}">
	<div class="pm-row-main">
		<span class="pm-name">${escapeHtml(friendly)}</span>
		<span class="pm-ver">v${escapeHtml(p.version || '?')}</span>
	</div>
	<div class="pm-badges">
		<span class="pm-badge reg">${escapeHtml(p.registry || 'registry')}</span>
	</div>
	<div class="pm-actions"><button class="pm-btn" data-action="install" title="Install">Install</button></div>
</div>`.trim();
}

/** One installed-plugin row. Buttons dispatch via `data-action` / `.pm-enable`. */
function rowHtml(p) {
	if (p.available && !p.installed) { return registryRowHtml(p); }

	const badge = (on, label) => `<span class="pm-badge${on ? ' on' : ''}">${label}</span>`;
	const friendly = p.pluginName && p.pluginName !== p.name ? p.pluginName : p.name;
	const slug = p.pluginName && p.pluginName !== p.name ? `<span class="pm-slug">${escapeHtml(p.name)}</span>` : '';

	const actions = [
		'<button class="pm-btn pm-btn-icon" data-action="update" title="Update"><span class="ro-icon ro-icon-refresh-cw"></span></button>',
		'<button class="pm-btn pm-btn-icon" data-action="uninstall" title="Uninstall"><span class="ro-icon ro-icon-trash-2"></span></button>',
		`<label class="pm-enable-wrap" title="${p.enabled ? 'Disable' : 'Enable'}"><input type="checkbox" class="pm-enable"${p.enabled ? ' checked' : ''}> ${p.enabled ? 'on' : 'off'}</label>`,
	];

	return `
<div class="pm-row${p.enabled ? '' : ' is-disabled'}" data-name="${escapeHtml(p.name)}">
	<div class="pm-row-main">
		<span class="pm-name">${escapeHtml(friendly)}</span>${slug}
		<span class="pm-ver">v${escapeHtml(p.version || '?')}</span>
	</div>
	<div class="pm-badges">
		${badge(p.installed, 'local')}${badge(p.enabled, 'enabled')}${p.debug ? '<span class="pm-badge dbg">debug</span>' : ''}${p.updateAvailable ? '<span class="pm-badge upd">update</span>' : ''}
	</div>
	<div class="pm-actions">${actions.join('')}</div>
</div>`.trim();
}

/** @type {import('../native-manager.d.ts').NativePlugin['init']} */
const init = (pars, deps) => {
	const ui = deps.ui;
	const icons = deps.icons;
	const lifecycle = deps.lifecycle;
	const LPM = deps.LocalPluginManager; // may be undefined → degrade gracefully

	let panel = null;
	let lastRows = [];
	let query = '';
	let unsub = null;

	// ── shadow-routed DOM helpers (all queries go through the component root) ──
	function setStatus(msg) {
		if (!panel) { return; }
		const el = ui.find(panel, '.pm-status');
		if (el) { el.textContent = msg; }
	}

	function filtered() {
		if (!query) { return lastRows; }
		return lastRows.filter((p) =>
			(p.pluginName || '').toLowerCase().includes(query) ||
			(p.name || '').toLowerCase().includes(query));
	}

	function renderRows() {
		if (!panel) { return; }
		const listEl = ui.find(panel, '.pm-list');
		if (!listEl) { return; }
		const rows = filtered();
		listEl.innerHTML = rows.length
			? rows.map(rowHtml).join('')
			: '<div class="pm-empty">No plugins installed.</div>';
	}

	// ── data : local-only ⇒ installed (IndexedDB, no network) ; with registries ⇒
	//    installed merged with the registry listings (installable + update badges) ──
	async function refresh() {
		if (!LPM) { setStatus('LocalPluginManager not loaded'); return; }
		try {
			const hasRegistries = LPM.registries().length > 0;
			lastRows = hasRegistries ? await LPM.list() : await LPM.listInstalled();
			const installed = lastRows.filter((p) => p.installed).length;
			setStatus(hasRegistries ? `${installed} installed · registry` : `${installed} installed`);
		} catch (e) {
			setStatus('Error: ' + ((e && e.message) || e));
			lastRows = [];
		}
		renderRows();
	}

	// ── action delegation : EVERY action → LPM ; onChange re-renders the rows ──
	async function perform(action, name) {
		if (!LPM || !name) { return; }
		try {
			let r;
			if (action === 'update') { r = await LPM.update(name); }
			else if (action === 'uninstall') { r = await LPM.remove(name); }
			else if (action === 'enable') { r = await LPM.enable(name); }
			else if (action === 'disable') { r = await LPM.disable(name); }
			// Soft failures resolve `{ ok:false, error }` (no throw) — surface them.
			if (r && r.ok === false) { setStatus(`${action} failed: ${r.error || 'unknown'}`); }
			// no manual re-list — the mutation fires LPM.onChange → refresh()
		} catch (e) {
			setStatus('Error: ' + ((e && e.message) || e));
		}
	}

	async function installFromUrl() {
		if (!LPM) { return; }
		const input = ui.find(panel, '.pm-url');
		const url = input && input.value ? input.value.trim() : '';
		if (!url) { return; }
		try {
			await LPM.installFromUrl(url);
			if (input) { input.value = ''; }
		} catch (e) {
			setStatus('Install failed: ' + ((e && e.message) || e));
		}
	}

	// Install a listed registry entry (the row carries the plugin url in data-url).
	async function installFromRegistry(url) {
		if (!LPM || !url) { return; }
		try {
			await LPM.installFromUrl(url);
		} catch (e) {
			setStatus('Install failed: ' + ((e && e.message) || e));
		}
	}

	// Upload button → OS file picker → install the chosen file (same path as drop).
	// A transient input appended to the document (a shadow-hosted input's picker is
	// unreliable); removed after change.
	function pickFile() {
		if (!LPM) { return; }
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.js,.mjs';
		input.style.display = 'none';
		input.addEventListener('change', async () => {
			const file = input.files && input.files[0];
			if (file) {
				try { await LPM.installFromFile(file); }
				catch (e) { setStatus('Install failed: ' + ((e && e.message) || e)); }
			}
			input.remove();
		});
		document.body.appendChild(input);
		input.click();
	}

	// ── event binding : once, after the first append (survives detach) ──
	function bindOnce(p) {
		ui.on(p, '.pm-close', () => winHandle.hide());
		ui.on(p, '.pm-refresh', () => refresh());
		ui.on(p, '.pm-install-btn', () => installFromUrl());
		ui.on(p, '.pm-upload-btn', () => pickFile());
		ui.on(p, '.pm-url', 'keydown', (e) => { if (e.key === 'Enter') { installFromUrl(); } });
		ui.on(p, '.pm-search', 'input', (e) => {
			query = (e.target && e.target.value ? e.target.value : '').toLowerCase();
			renderRows();
		});

		// Delegated listeners on the (static) list container survive re-renders.
		const listEl = ui.find(p, '.pm-list');
		if (listEl) {
			listEl.addEventListener('click', (e) => {
				const btn = e.target.closest('[data-action]');
				if (!btn) { return; }
				const row = e.target.closest('[data-name]');
				if (!row) { return; }
				const action = btn.getAttribute('data-action');
				if (action === 'install') { installFromRegistry(row.getAttribute('data-url')); return; }
				perform(action, row.getAttribute('data-name'));
			});
			listEl.addEventListener('change', (e) => {
				const box = e.target.closest('.pm-enable');
				if (!box) { return; }
				const row = e.target.closest('[data-name]');
				if (!row) { return; }
				perform(box.checked ? 'enable' : 'disable', row.getAttribute('data-name'));
			});
		}
	}

	// ── panel : GUIComponent (shadow DOM), mounted + reasserted by the ui lib ──
	const winHandle = ui.registerPlayerWindow(
		function panelFactory() {
			const GUIComponent = deps.UIComponent; // ENGINE.UIComponent === GUIComponent
			const c = new GUIComponent('PluginManagerPanel', CSS);
			c.render = function () { return HTML; };
			c.init = function () {
				// `.ro-icon` CSS must land INSIDE the shadow root — a global rule in
				// document.head does not pierce it.
				icons.injectIconCss(this.getRoot());
			};
			return c;
		},
		{
			defaultVisible: false, // hidden until Alt+Shift+P
			onMount(p) {
				panel = p;
				// Position the light-DOM host (drag moves these same host coords).
				const host = ui.root(p);
				if (host) { host.style.left = '70px'; host.style.top = '70px'; }
				ui.makeDraggable(p, '.pm-header');
				bindOnce(p);
				// Local-only (no registries) : hide the URL install field — install is
				// file-only (drag&drop + the upload button). Registries are config-static,
				// so this is decided once at mount.
				if (!LPM || LPM.registries().length === 0) {
					const urlEl = ui.find(p, '.pm-url');
					if (urlEl) { urlEl.style.display = 'none'; }
					const instBtn = ui.find(p, '.pm-install-btn');
					if (instBtn) { instBtn.style.display = 'none'; }
				}
				refresh();
				// Re-render on every LPM mutation (install/enable/disable/remove/update).
				if (LPM) { unsub = LPM.onChange(refresh); }
			},
		},
	);

	// ── hotkey Alt+Shift+P : composedPath()[0] because a document-capture keydown
	//    sees a RETARGETED e.target (the host) for events from inside the shadow ──
	function onKeyDown(e) {
		if (!(e.altKey && e.shiftKey && e.code === 'KeyP')) { return; }
		const t = (e.composedPath && e.composedPath()[0]) || e.target;
		const tag = t && t.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) { return; }
		e.preventDefault();
		e.stopPropagation();
		winHandle.toggle();
	}
	window.addEventListener('keydown', onKeyDown, true);

	// ── teardown : unsubscribe onChange, drop the hotkey, dispose the window ──
	lifecycle.registerCleanup(function () {
		if (unsub) { unsub(); }
		window.removeEventListener('keydown', onKeyDown, true);
		winHandle.dispose();
	});

	return true;
};

/** @type {import('../native-manager.d.ts').NativePlugin} */
export default {
	name: 'PluginManagerUI',
	version: VERSION,
	deps: ['LocalPluginManager'],
	init,
};
