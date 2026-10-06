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
import { dump, load, summarize } from './backup.js';

/**
 * Normalize `pars.registries` into `[{ label, url }]` (config order).
 *   - falsy / '' / {}         → []  (local-only: drag&drop + file-picker only)
 *   - 'https://…'             → [{ label: null, url }]
 *   - { LocalName: url, … }   → [{ label, url }] in insertion order
 * The local map key becomes the display label (else the listing's own `name`).
 */
function normalizeRegistries(registries) {
	if (!registries) { return []; }
	if (typeof registries === 'string') {
		return registries ? [{ label: null, url: registries }] : [];
	}
	if (typeof registries === 'object') {
		const out = [];
		for (const label in registries) {
			const url = registries[label];
			if (url) { out.push({ label, url: String(url) }); }
		}
		return out;
	}
	return [];
}

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

		// `pars.registries` (from the ROConfig.plugins `{ path, pars }` entry) declares
		// the plugin registries. Empty ⇒ local-only (drag&drop + file-picker install).
		const registries = normalizeRegistries(pars && pars.registries);
		const store = createPluginStore({ W: window, PluginManager: PluginHost, logger, registries });

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
		// `/pm <name>` subcommands contributed by other plugins (built-ins win).
		const extraSubs = {};
		function notifyChange() {
			for (let i = 0; i < changeSubs.length; i++) {
				try { changeSubs[i](); }
				catch (e) { console.error('[LPM onChange]', e); }
			}
		}

		// Derive a slug (IDB key) from a URL or a dropped filename.
		function stripExt(base) {
			return base.replace(/\.di\.esm\.js$|\.debug\.esm\.js$|\.esm\.js$/i, '') || base;
		}
		function baseFromUrl(url) {
			try {
				const u = new URL(url, window.location.href);
				return (u.pathname.split('/').pop() || '').split(/[?#]/)[0];
			} catch (_e) {
				return String(url).split('/').pop().split(/[?#]/)[0];
			}
		}
		function slugFromUrl(url) {
			return stripExt(baseFromUrl(url)) || String(url);
		}
		// Transitional : only DI builds (`<slug>.di.esm.js`) install here, until
		// the v3 host passes `deps` too and only DI artefacts remain. Reports to
		// the ChatBox itself, so callers skip their own report (`reported`).
		function refuseNonDi(base) {
			if (/\.di\.esm\.js$/i.test(base)) { return; }
			const err = new Error(`'${base}' is not a DI build — only <slug>.di.esm.js installs here`);
			err.reported = true;
			report('PM: install refused — ' + err.message, true);
			throw err;
		}

		// ── Rich exported API (delegates to the store, fires onChange) ─────────
		const LPM = {
			list: () => store.list(),
			listInstalled: () => store.listInstalled(),
			registries: () => registries,
			async installFromUrl(url, opts) {
				refuseNonDi(baseFromUrl(url));
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
			// Read a dropped / picked File and install it (derives the slug from the
			// filename). Shared by the drag&drop handler and the UI's upload button.
			async installFromFile(file) {
				refuseNonDi(file.name);
				const source = await file.text();
				const slug = stripExt(file.name);
				const r = await store.installFromSource(source, slug);
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
			addSubcommand(name, fn, usage) {
				if (typeof fn !== 'function') { return () => {}; }
				const key = String(name).toLowerCase();
				extraSubs[key] = { fn, usage: usage || key };
				return () => { if (extraSubs[key] && extraSubs[key].fn === fn) { delete extraSubs[key]; } };
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
			catch (e) { if (!e.reported) { report('PM: install failed — ' + e.message, true); } }
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
		async function pmBackup(flags) {
			try {
				const words = flags.map(w => w.toLowerCase());
				const dataOnly = words.includes('data');
				const backup = await dump({ excludeWinLogin: words.includes('nologin'), excludePlugins: dataOnly });
				const file = (dataOnly ? 'ro-backup-data-' : 'ro-backup-') + backup.date.replace(/:/g, '-') + '.json';
				const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
				const a = document.createElement('a');
				a.href = url;
				a.download = file;
				a.click();
				URL.revokeObjectURL(url);
				const n = summarize(backup);
				report(`PM: backup — ${n.keys} key(s), ${n.databases} database(s) / ${n.records} record(s), ${n.plugins} plugin(s) → ${file}`, false);
			} catch (e) { report('PM: backup failed — ' + e.message, true); }
		}
		// Synchronous on purpose: the picker needs the ChatBox Enter as its user gesture.
		function pmRestore() {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json,application/json';
			input.onchange = async () => {
				const file = input.files && input.files[0];
				if (!file) { return; }
				try {
					const r = await load(await file.text());
					report(`PM: restored ${r.keys} key(s), ${r.databases} database(s) / ${r.records} record(s), ${r.plugins} plugin(s) from ${file.name} — reload now (a live window would overwrite its restored key)`, false);
					if (r.skipped.length) { report('PM: restore skipped (newer schema here): ' + r.skipped.join(', '), true); }
				} catch (e) { report('PM: restore failed — ' + e.message, true); }
			};
			input.click();
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
				case 'backup':  pmBackup(args.slice(1)); break;
				case 'restore': pmRestore(); break;
				default: {
					const extra = extraSubs[sub];
					if (extra) {
						try { extra.fn(args.slice(1)); }
						catch (e) { report(`PM: ${sub} failed — ${e.message}`, true); }
						break;
					}
					let usage = 'PM: usage — /pm list | install <url> | enable <name> | disable <name> | remove <name> | backup [data] [nologin] | restore';
					for (const k in extraSubs) { usage += ' | ' + extraSubs[k].usage; }
					report(usage, false);
				}
			}
		}
		Commands.add('pm', 'Local plugin manager: list / install <url> / enable / disable / remove / backup [data] [nologin] / restore', pmHandler);

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
					const r = await LPM.installFromFile(file);
					report(`PM: installed '${r.name}' (${r.pluginName} v${r.version || '?'}) from drop`, false);
				} catch (err) {
					if (!err.reported) { report(`PM: drop install failed for ${file.name} — ${err.message}`, true); }
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
