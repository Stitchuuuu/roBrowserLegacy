/**
 * native-manager.d.ts — ambient types for the native DI plugin host.
 *
 * The native plugin manager (`src/Plugins/native-manager/`) calls each plugin's
 * `init(pars, deps)` with `deps` = the DI map assembled by `di.js` `buildDiMap()`.
 * This file types that map (`DiMap`) by linking each key to the REAL source
 * module (`typeof import('../src/…')`), so types stay in sync with the engine /
 * lib implementations automatically — plus the `LocalPluginManager` cross-plugin
 * API (`LocalPluginManagerAPI`), which is a plugin (not a src module) so it's
 * hand-typed.
 *
 * Two ways to get autocompletion in a hand-authored `.esm.js` plugin :
 *
 *   1. Type the default export (recommended — ONE annotation, also types
 *      name/version/deps and infers `deps` inside init via contextual typing) :
 *
 *        /** @type {import('../native-manager.d.ts').NativePlugin} *\/
 *        export default {
 *          name: 'MyPlugin', deps: ['LocalPluginManager'],
 *          init(pars, deps) { deps.LocalPluginManager?.listInstalled() },
 *        }
 *
 *   2. Or annotate init directly :
 *        /** @param {any} pars @param {import('../native-manager.d.ts').DiMap} deps *\/
 *
 * This is a MODULE (it `export`s), referenced via `import('...').X`. Every DI
 * value may be `undefined` at runtime (the no-crash contract) ; the
 * `[key: string]: unknown` index reflects that for un-injected keys and
 * cross-plugin exports.
 */

// ── LocalPluginManager — the rich API returned by LPM's init(), keyed under
//    `LocalPluginManager` in a consumer's DI map (a plugin, not a src module) ──

/** One plugin record from `list()` / `listInstalled()`. `name` is the SLUG
 *  (IndexedDB key / URL component) — the id passed to enable/disable/remove/… */
export interface LpmRow {
	name: string;
	pluginName: string | null;
	version: string | null;
	installed: boolean;
	enabled: boolean;
	debug: boolean;
	available: boolean;
	/** Registry-listing fields (present on `list()` rows when registries are set). */
	url?: string | null;
	registry?: string | null;
	updateAvailable?: boolean;
}

/** Result of a mutation. Failures generally resolve `{ ok:false, error }` rather
 *  than throwing (install/update throw on network/exec errors). */
export interface LpmResult {
	ok: boolean;
	name: string;
	pluginName?: string | null;
	version?: string | null;
	oldVersion?: string | null;
	error?: string;
}

export interface LocalPluginManagerAPI {
	/** Installed (IndexedDB) merged with the configured registry listings
	 *  (`pars.registries`). Rows gain `url`/`registry`/`updateAvailable`; a dead
	 *  registry is skipped, not fatal. Equals `listInstalled()` in local-only mode. */
	list(): Promise<LpmRow[]>;
	/** Installed only — IndexedDB, no network. */
	listInstalled(): Promise<LpmRow[]>;
	/** The normalized plugin registries from `pars.registries` (empty ⇒ local-only). */
	registries(): Array<{ label: string | null; url: string }>;
	installFromUrl(url: string, opts?: { debug?: boolean; origin?: string }): Promise<LpmResult>;
	installFromSource(source: string, name: string, opts?: { debug?: boolean }): Promise<LpmResult>;
	/** Read a dropped / picked File and install it (slug from the filename). */
	installFromFile(file: File): Promise<LpmResult>;
	enable(name: string): Promise<LpmResult>;
	disable(name: string): Promise<LpmResult>;
	remove(name: string): Promise<LpmResult>;
	update(name: string): Promise<LpmResult>;
	refreshAll(): Promise<{ updated: number; failed: number; results: LpmResult[] }>;
	/** Fires (zero-arg) after every mutation. Returns an unsubscribe function. */
	onChange(cb: () => void): () => void;
	/**
	 * Adds a `/pm <name>` subcommand (built-ins win on a name clash) ; `usage` is
	 * appended to the `/pm` usage line. Returns a function that removes it.
	 */
	addSubcommand(name: string, fn: (args: string[]) => void, usage?: string): () => void;
}

/** LocalPluginManager's own config — passed as `pars` via its `ROConfig.plugins`
 *  `{ path, pars }` entry, read in its `init(pars, deps)`. `registries` declares
 *  plugin registries: a single listing URL, a `{ LocalName: url }` map for many,
 *  or empty/absent for local-only mode (drag&drop + file-picker install). */
export interface LocalPluginManagerPars {
	registries?: string | { [label: string]: string };
}

/** Runtime host injected into every plugin's DI map (used by LPM). */
export interface PluginHostAPI {
	register(def: any, pars?: any, mod?: any): Promise<unknown>;
	unregister(name: string): void;
	list(): Array<{ name: string }>;
}

/** One item record — see `robrowser/tools/v3/libs/item-db/src/index.js` for the
 *  full shape (name/type/buy/sell/weight/script/effect/bonuses/…); typed loosely
 *  here since consumers mostly read `.name` and pass records through. */
export interface ItemDbRecord {
	id: number;
	name: string;
	[key: string]: unknown;
}

/** ItemDb's `init()`-return — the pre-renewal item database, keyed under
 *  `ItemDb` in a consumer's DI map. `ready` resolves once the IndexedDB cache
 *  (`ROFW_items`) is populated from the same-origin bundle fetch; getters are
 *  safe to call before `ready` resolves (they return `null`/`[]`/`0`). */
export interface ItemDbApi {
	get(id: number | string): ItemDbRecord | null;
	search(query: string): Array<{ id: number; name: string }>;
	all(): Record<string, ItemDbRecord> | null;
	usedBy(id: number | string): unknown | null;
	producedBy(id: number | string): unknown | null;
	unlocks(id: number | string): unknown | null;
	count(): number;
	version: string;
	ready: Promise<Record<string, ItemDbRecord>>;
}

declare global {
	/**
	 * Cross-plugin exports contributed to the DI map. A plugin that exposes an API
	 * from its `init()`-return can add its key HERE, or — for a third-party plugin
	 * you don't want to edit this file for — **augment this interface from its own
	 * `.d.ts`** (no edit to native-manager.d.ts needed) ; the key then autocompletes
	 * on `deps.<Name>` for every consumer :
	 *
	 *   // some-plugin.d.ts (co-located with the plugin, part of the TS project)
	 *   export interface SomePluginApi { doThing(): void }
	 *   declare global {
	 *     interface ROPluginExports { SomePlugin?: SomePluginApi }
	 *   }
	 *   export {};
	 *
	 * Every entry is optional (`?`) : a consumer whose producer didn't load reads
	 * `undefined` (the no-crash contract). `DiMap` extends this interface, so
	 * augmentations flow into `deps` automatically.
	 */
	interface ROPluginExports {
		LocalPluginManager?: LocalPluginManagerAPI;
		ItemDb?: ItemDbApi;
	}
}

// ── Real-module type links. Object/namespace exports are wrapped in an
//    `interface … extends (typeof import('../src/…'))` : an interface RETAINS its
//    name in hover (`deps.lifecycle: Lifecycle`) — a bare `type X = typeof
//    import(…)` alias expands back to the raw path — while still inheriting every
//    member from the real source module. Class exports stay as a `type` (they
//    already hover as `typeof GUIComponent`). ─────────────────────────────────

type _UiMod = typeof import('../src/Plugins/native-manager/libs/ui.js');
/** The `ui` DOM-helper lib — find/on/root/makeDraggable/registerPlayerWindow/… */
export interface Ui extends _UiMod {}

type _LifecycleMod = typeof import('../src/Plugins/native-manager/libs/lifecycle.js');
/** The `lifecycle` lib — registerCleanup/isWired/hasReached/flushCleanup/… */
export interface Lifecycle extends _LifecycleMod {}

type _IconsMod = typeof import('../src/Plugins/native-manager/libs/icons.js');
/** The `icons` lib — icon/injectIconCss/ICONS. */
export interface Icons extends _IconsMod {}

type _ChatBoxMod = typeof import('../src/UI/Components/ChatBox/ChatBox.js').default;
/** The ChatBox singleton — addText/TYPE/FILTER/… */
export interface ChatBox extends _ChatBoxMod {}

type _CommandsMod = typeof import('../src/Controls/ProcessCommand.js').default;
/** The Commands registry — add/remove/processCommand/… */
export interface Commands extends _CommandsMod {}

type _EntityManagerMod = typeof import('../src/Renderer/EntityManager.js').default;
export interface EntityManager extends _EntityManagerMod {}

type _PacketMod = typeof import('../src/Network/PacketStructure.js').default;
/** The PACKET namespace — PACKET.ZC.* / PACKET.CA.* (each ctor has `.build`). */
export interface PacketStructure extends _PacketMod {}

/** GUIComponent (Shadow-DOM base) constructor — `deps.UIComponent === GUIComponent`. */
export type GUIComponentClass = typeof import('../src/UI/GUIComponent.js').default;
/** The `(name, html, css)` window class (`deps.LegacyUIComponent`) — transitional. */
export type LegacyUIComponentClass = typeof import('../src/Plugins/native-manager/legacy-ui-component.js').default;
/** Preferences (localStorage-backed) — `static get/save`. */
export type PreferencesClass = typeof import('../src/Core/Preferences.js').default;

type EventBus = typeof import('../src/Plugins/native-manager/libs/event-bus.js');
type PacketObserver = typeof import('../src/Plugins/native-manager/libs/packet-observer.js');
type SocketObserver = typeof import('../src/Plugins/native-manager/libs/socket-observer.js');
type DevLogLib = typeof import('../src/Plugins/native-manager/libs/dev-log.js');
type PluginApi = typeof import('../src/Plugins/native-manager/libs/plugin-api.js');
type FetchInterceptLib = typeof import('../src/Plugins/native-manager/libs/fetch-intercept.js')['fetchIntercept'];

/** Every native lib namespace, keyed by its plain lib name (`deps.libs`). */
export interface Libs {
	'plugin-api': PluginApi;
	'event-bus': EventBus;
	lifecycle: Lifecycle;
	ui: Ui;
	icons: Icons;
	'packet-observer': PacketObserver;
	'socket-observer': SocketObserver;
	'dev-log': DevLogLib;
	/** Fetch middleware, page + asset worker. `register` throws unless `ROConfigOptions.fetchIntercept` is on. */
	'fetch-intercept': FetchInterceptLib;
}

/** `ROConfig` options for the native plugin manager. */
export interface ROConfigOptions {
	/** Server-owner gate: start the asset worker and enable `deps.libs['fetch-intercept']`. Default off. */
	fetchIntercept?: boolean;
}

// ── The DI map (2nd arg of init(pars, deps)) ──────────────────────────────────

export interface DiMap extends ROPluginExports {
	// engine modules (default exports of the real source files)
	PACKET: PacketStructure;
	ChatBox: ChatBox;
	UIComponent: GUIComponentClass;
	LegacyUIComponent: LegacyUIComponentClass;
	Preferences: PreferencesClass;
	Commands: Commands;
	EntityManager: EntityManager;

	// native libs (whole module namespaces)
	ui: Ui;
	lifecycle: Lifecycle;
	icons: Icons;

	// event bus (flattened) + observers + helpers (individual exports)
	on: EventBus['on'];
	off: EventBus['off'];
	once: EventBus['once'];
	emit: EventBus['emit'];
	EVENTS: EventBus['EVENTS'];
	observePacket: PacketObserver['observePacket'];
	observeSendPacket: PacketObserver['observeSendPacket'];
	observeSocket: SocketObserver['observeSocket'];
	devLog: DevLogLib['devLog'];
	icon: Icons['icon'];
	libs: Readonly<Libs>;

	// runtime host + the cross-plugin exports (via `extends ROPluginExports`
	// above — augmentable). Any other key is `undefined` (no-crash contract).
	PluginHost: PluginHostAPI;
	[key: string]: unknown;
}

/** A native-manager plugin's default export. Annotate the export with this
 *  (`/** @type {import('../native-manager.d.ts').NativePlugin} *\/`) to type
 *  `name`/`version`/`deps` and auto-infer `deps` (= DiMap) inside `init`. */
export interface NativePlugin {
	name: string;
	version?: string;
	deps?: string[];
	init(pars: any, deps: DiMap): any | Promise<any>;
}
