/**
 * LocalPluginManager (LPM) — the plugin that owns RUNTIME plugin installs: an
 * IndexedDB store (see ./plugin-store.js), drag-and-drop `.esm.js` install,
 * textual `/pm` commands + error surfacing in the ChatBox, and a rich exported
 * API for other plugins to drive it programmatically.
 *
 * An ordinary `ROConfig.plugins` entry — no special config key. List it LAST so
 * its bootLoad() runs after the other plugins register, letting its restored
 * plugins resolve deps against the fully-registered set.
 *
 * Pure DI — no `@robrowser/*` static import, no ambient global. It receives the
 * engine modules + the runtime host (`PluginHost = { register, unregister,
 * list }`) via its DI map, and exposes its API by RETURNING it from init(). A
 * consumer that declares `deps: ['LocalPluginManager']` receives that API
 * directly as `deps.LocalPluginManager` (a producer's init()-return is the DI
 * value keyed by its name) and delegates its actions to it.
 *
 * Store execution model (install / drop / boot are identical):
 *   source → Blob → import(blobUrl) → PluginHost.register(mod.default, null, mod)
 * so a restored plugin joins the same DI path as a config-declared one.
 */

import { createPluginStore } from './plugin-store.js';

export default {
	name: 'LocalPluginManager',
	version: '0.1.0',

	async init(pars, di) {
		const ChatBox = di.ChatBox;
		const Commands = di.Commands;
		const lifecycle = di.lifecycle;
		const PluginHost = di.PluginHost;

		if (!PluginHost) {
			// The native manager injects PluginHost into every plugin's DI map; a
			// missing one means LPM is running on an older core — installs can't work.
			console.error('[LPM] PluginHost missing from DI — native manager too old? Installs will not work.');
		}

		// Quiet logger for the store: swallow the happy-path `[plugin-store]`
		// chatter so the console stays clean, keep warn/error visible.
		const logger = {
			log() {},
			warn(...a) { console.warn(...a); },
			error(...a) { console.error(...a); },
		};

		const store = createPluginStore({ W: window, PluginManager: PluginHost, logger });

		// ── ChatBox output / error surfacing ──────────────────────────────────
		// Pre-mount (login/char-select) the ChatBox buffers but never renders, so
		// fall back to the console there. In-game (`__active`) it prints a line.
		function report(msg, isError) {
			if (ChatBox && ChatBox.__active) {
				ChatBox.addText(msg, isError ? ChatBox.TYPE.ERROR : ChatBox.TYPE.INFO, ChatBox.FILTER.PUBLIC_LOG);
			} else if (isError) {
				console.warn(msg);
			} else {
				console.log(msg);
			}
		}

		// ── onChange subscribers (let a UI re-render after every mutation) ────
		const changeSubs = [];
		function notifyChange() {
			for (let i = 0; i < changeSubs.length; i++) {
				try { changeSubs[i](); }
				catch (e) { console.error('[LPM onChange]', e); }
			}
		}

		// Derive a slug (IDB key) from a URL or a dropped filename.
		function stripExt(base) {
			return base.replace(/\.debug\.esm\.js$|\.esm\.js$/i, '') || base;
		}
		function slugFromUrl(url) {
			try {
				const u = new URL(url, window.location.href);
				const base = (u.pathname.split('/').pop() || '').split(/[?#]/)[0];
				return stripExt(base) || url;
			} catch (_e) {
				const base = String(url).split('/').pop().split(/[?#]/)[0];
				return stripExt(base) || String(url);
			}
		}

		// ── Rich exported API (delegates to the store, fires onChange) ─────────
		const LPM = {
			list: (origin) => store.list(origin),
			listInstalled: () => store.listInstalled(),
			async installFromUrl(url, opts) {
				const slug = slugFromUrl(url);
				const r = await store.install(slug, { ...(opts || {}), sourceUrl: url });
				notifyChange();
				return r;
			},
			async installFromSource(source, name, opts) {
				const r = await store.installFromSource(source, name, opts);
				notifyChange();
				return r;
			},
			async enable(name)  { const r = await store.enable(name);    notifyChange(); return r; },
			async disable(name) { const r = await store.disable(name);   notifyChange(); return r; },
			async remove(name)  { const r = await store.uninstall(name); notifyChange(); return r; },
			async update(name)  { const r = await store.update(name);    notifyChange(); return r; },
			async refreshAll()  { const r = await store.refreshAll();    notifyChange(); return r; },
			onChange(cb) {
				if (typeof cb !== 'function') { return () => {}; }
				changeSubs.push(cb);
				return () => { const i = changeSubs.indexOf(cb); if (i >= 0) { changeSubs.splice(i, 1); } };
			},
		};

		// ── /pm textual commands (ChatBox) ────────────────────────────────────
		async function pmList() {
			try {
				const rows = await store.listInstalled();
				if (!rows.length) { report('PM: no plugins installed', false); return; }
				report(`PM: ${rows.length} plugin(s) installed —`, false);
				for (let i = 0; i < rows.length; i++) {
					const r = rows[i];
					report(`  • ${r.name}${r.pluginName ? ' (' + r.pluginName + ')' : ''} v${r.version || '?'} — ${r.enabled ? 'enabled' : 'disabled'}`, false);
				}
			} catch (e) { report('PM: list failed — ' + e.message, true); }
		}
		async function pmInstall(url) {
			if (!url) { report('PM: usage — /pm install <url>', true); return; }
			try { const r = await LPM.installFromUrl(url); report(`PM: installed '${r.name}' (${r.pluginName} v${r.version || '?'})`, false); }
			catch (e) { report('PM: install failed — ' + e.message, true); }
		}
		async function pmEnable(name) {
			if (!name) { report('PM: usage — /pm enable <name>', true); return; }
			try { const r = await LPM.enable(name); report(r.ok ? `PM: enabled '${name}'` : `PM: enable '${name}' — ${r.error}`, !r.ok); }
			catch (e) { report('PM: enable failed — ' + e.message, true); }
		}
		async function pmDisable(name) {
			if (!name) { report('PM: usage — /pm disable <name>', true); return; }
			try { const r = await LPM.disable(name); report(r.ok ? `PM: disabled '${name}'` : `PM: disable '${name}' — ${r.error}`, !r.ok); }
			catch (e) { report('PM: disable failed — ' + e.message, true); }
		}
		async function pmRemove(name) {
			if (!name) { report('PM: usage — /pm remove <name>', true); return; }
			try { const r = await LPM.remove(name); report(r.ok ? `PM: removed '${name}'` : `PM: remove '${name}' — ${r.error}`, !r.ok); }
			catch (e) { report('PM: remove failed — ' + e.message, true); }
		}
		// Commands binds the callback to ChatBox; we use captured refs, not `this`.
		// `text` is the whole line minus the leading slash, incl. the command word.
		function pmHandler(text) {
			const args = String(text).trim().split(/\s+/).slice(1); // drop 'pm'
			const sub = (args[0] || '').toLowerCase();
			switch (sub) {
				case 'list':    pmList(); break;
				case 'install': pmInstall(args[1]); break;
				case 'enable':  pmEnable(args[1]); break;
				case 'disable': pmDisable(args[1]); break;
				case 'remove':
				case 'uninstall': pmRemove(args[1]); break;
				default:
					report('PM: usage — /pm list | install <url> | enable <name> | disable <name> | remove <name>', false);
			}
		}
		Commands.add('pm', 'Local plugin manager: list / install <url> / enable / disable / remove', pmHandler);

		// ── Drag-and-drop `.esm.js` install ───────────────────────────────────
		// Capture phase so we run before the canvas / Intro / component handlers
		// that `stopImmediatePropagation()`. We only consume drops that carry an
		// `.esm.js` file — anything else falls through to the existing handlers.
		function hasFiles(dt) {
			return !!dt && !!dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
		}
		function onDragOver(e) {
			if (hasFiles(e.dataTransfer)) { e.preventDefault(); } // signal droppable
		}
		async function onDrop(e) {
			const dt = e.dataTransfer;
			if (!dt || !dt.files || !dt.files.length) { return; }
			const files = Array.prototype.filter.call(dt.files, f => /\.esm\.js$/i.test(f.name));
			if (!files.length) { return; } // not ours — let other drop handlers run
			e.preventDefault();
			e.stopImmediatePropagation();
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				try {
					const source = await file.text();
					const slug = stripExt(file.name);
					const r = await LPM.installFromSource(source, slug);
					report(`PM: installed '${slug}' (${r.pluginName} v${r.version || '?'}) from drop`, false);
				} catch (err) {
					report(`PM: drop install failed for ${file.name} — ${err.message}`, true);
				}
			}
		}
		document.addEventListener('dragover', onDragOver, true);
		document.addEventListener('drop', onDrop, true);

		// ── Teardown (owner-scoped to LocalPluginManager) — registered BEFORE
		// bootLoad so the scope isn't affected by the nested registrations. ──────
		if (lifecycle && typeof lifecycle.registerCleanup === 'function') {
			lifecycle.registerCleanup(() => {
				document.removeEventListener('dragover', onDragOver, true);
				document.removeEventListener('drop', onDrop, true);
				Commands.remove('pm');
			});
		}

		// ── Restore stored plugins. AWAITED so it runs entirely inside our own
		// register() call (sequential boot), NOT concurrently with the boot loop's
		// remaining plugins — that's what keeps the nested owner-scoping sound.
		// Each stored plugin registers via PluginHost → nested register(); the
		// nest-safe scoping keeps our owner intact across it. Success is already
		// evidenced by the per-plugin `[NativePM] registered:` lines, so we only
		// surface a failure count here (console stays quiet on the happy path).
		const { loaded, failed } = await store.bootLoad();
		if (failed > 0) {
			report(`PM: restored ${loaded} plugin(s), ${failed} failed`, true);
		}

		return LPM;
	},
};
