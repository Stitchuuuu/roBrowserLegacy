/**
 * ui — DOM helpers on top of UIComponent/GUIComponent + plugin-window
 * lifecycle.
 *
 * Plugins MUST NOT reach into jQuery directly. These helpers bridge the
 * component → DOM gap; if the base component ever changes its DOM plumbing, we
 * update this one file and plugins keep working.
 *
 * **Shadow-DOM routing (native improvement).** GUIComponent is Shadow-DOM
 * native: its `.ui[0]` is the *light-DOM host* (carries position/visibility),
 * but its content lives in the *shadow root*. So selector queries are routed
 * through `component.getRoot()` (the shadow root for GUIComponent, a jQuery
 * wrapper fallback for a legacy UIComponent) — a raw `ui[0].querySelector`
 * would miss shadow content. `root()` stays the host for positioning/visibility.
 *
 * Plain function exports — `root`/`find`/`findAll`/`on`/`makeDraggable`/
 * `registerWindow` are stateless; `registerPlayerWindow` keeps a module-scope
 * registry of windows it owns so it can dispatch the shared bus subscriptions
 * to each handle.
 */

import { UIManager, Preferences } from './plugin-api.js'
import { on as busOn, EVENTS } from './event-bus.js'
import { hasReached, registerCleanup } from './lifecycle.js'

/**
 * Return the light-DOM host element of a component (carries position / z-index /
 * visibility), or `null` if it isn't mounted yet. Use this for positioning and
 * show/hide — for selector queries into the component's content, use
 * `find`/`findAll` (which route into the shadow root).
 * @param {any} component
 * @returns {HTMLElement | null}
 */
export function root(component) {
	return (component?.ui && component.ui[0]) || null
}

/**
 * Resolve the element that selector queries should scope to. For GUIComponent
 * this is the shadow root (`getRoot()`), where the rendered content lives; for
 * a legacy UIComponent it's the jQuery wrapper's first element.
 * @param {any} component
 * @returns {HTMLElement | ShadowRoot | null}
 */
function queryRoot(component) {
	if (!component) {return null}
	if (typeof component.getRoot === 'function') {return component.getRoot()}
	return (component.ui && component.ui[0]) || null
}

/**
 * Find the FIRST descendant matching `selector` inside a component's content
 * (routed into the shadow root for GUIComponent). Returns `null` if the
 * component isn't mounted or nothing matches.
 * @param {any} component
 * @param {string} selector CSS selector
 * @returns {HTMLElement | null}
 */
export function find(component, selector) {
	const r = queryRoot(component)
	return r ? r.querySelector(selector) : null
}

/**
 * Find ALL descendants matching `selector` inside a component's content.
 * Returns an empty array if the component isn't mounted.
 * @param {any} component
 * @param {string} selector CSS selector
 * @returns {NodeListOf<HTMLElement> | never[]}
 */
export function findAll(component, selector) {
	const r = queryRoot(component)
	return r ? r.querySelectorAll(selector) : []
}

/**
 * Bind a handler on the first element matching `selector` inside `component`.
 * Defaults to `'click'` when only three args are given.
 *
 * Signatures:
 *   on(comp, sel, fn)               → click handler
 *   on(comp, sel, 'dblclick', fn)   → explicit event name
 *
 * @param {any} component
 * @param {string} selector CSS selector of the target element
 * @param {string | ((e: Event) => void)} eventOrFn Event name, or handler
 *   (in which case the event defaults to `'click'`).
 * @param {(e: Event) => void} [fn] Handler when `eventOrFn` is an event name.
 * @returns {HTMLElement | null} The bound element, or `null` if not found.
 */
export function on(component, selector, eventOrFn, fn) {
	const event = typeof eventOrFn === 'string' ? eventOrFn : 'click'
	const handler = typeof eventOrFn === 'function' ? eventOrFn : fn
	const el = find(component, selector)
	if (el && handler) {el.addEventListener(event, handler)}
	return el
}

/**
 * Make the component draggable by its `handleSelector` child. Delegates to the
 * native `component.draggable(handle)` so we keep the engine's magnet/snap
 * behaviour. No-op if the component isn't mounted or the handle doesn't exist.
 *
 * @param {any} component
 * @param {string} handleSelector CSS selector of the drag handle (e.g. `.title-bar`).
 */
export function makeDraggable(component, handleSelector) {
	if (!component || !component.draggable || !component.ui) {return}
	const jq = component.ui.find ? component.ui.find(handleSelector) : null
	if (jq) {component.draggable(jq)}
}

/**
 * Strip a component's CSS block from a shared stylesheet the bundle uses for
 * component styles.
 *
 * **Legacy-UIComponent helper.** GUIComponent scopes each component's CSS
 * inside its own shadow root and tears it down with the component, so it does
 * not hit the shared-stylesheet dedup problem this function solves — for a
 * GUIComponent this is a harmless no-op (the block is never found in
 * `document`). Kept for legacy UIComponent forks that keep ALL component CSS in
 * one `<style>` and dedup by a per-component marker: on hot-reload the name is
 * reused, so the stale block stays and the freshly-built CSS is skipped.
 * Removing the block lets the next `prepare()` re-inject the new CSS.
 *
 * @param {string} name component name (e.g. `'TabTargetPanel'`).
 * @returns {boolean} true if a block was found and removed.
 */
export function purgeComponentCss(name) {
	if (!name) {return false}
	const marker = '\n\n/' + '** ' + name + ' **' + '/\n'
	const nextMarkerPrefix = '\n\n/' + '** '
	const styles = document.querySelectorAll('style')
	for (const el of styles) {
		const text = el.textContent || ''
		const start = text.indexOf(marker)
		if (start === -1) {continue}
		const after = text.indexOf(nextMarkerPrefix, start + marker.length)
		const end = after === -1 ? text.length : after
		el.textContent = text.slice(0, start) + text.slice(end)
		return true
	}
	return false
}

/**
 * Register a component with the native `UIManager` so it participates in the
 * focus / z-index system — click-to-front, drag-to-front, and coordination
 * with native windows. Without this call `component.manager` stays undefined
 * and `focus()` is a no-op, leaving plugin windows stranded below any
 * freshly-clicked native window.
 *
 * Must be called BEFORE `component.append()`. Direct assignment mirrors the
 * native `UIManager.addComponent()` body minus its `instanceof` safety check.
 *
 * @param {any} component
 * @returns {boolean} true if registered, false if UIManager is unavailable.
 */
export function registerWindow(component) {
	if (!component || !component.name) {return false}
	if (!UIManager.components) {return false;}
	/** @type {any} */ (component).manager = UIManager
	UIManager.components[component.name] = component
	return true
}

// ──────────────────────────────────────────────────────────────────────────
// registerPlayerWindow — plugin window lifecycle
// ──────────────────────────────────────────────────────────────────────────
//
// Mirrors how the native engine treats BasicInfo / Inventory / etc. across map
// changes :
//   - On every `map-ready` (post-fade signal from lifecycle, derived from a
//     Background.remove trap), the panel is (re-)appended to the DOM and
//     re-registered with UIManager. The native UIManager wipes plugin panels on
//     `map-leave` (its removeComponents() phase), so without this re-mount the
//     window vanishes after every TP.
//   - With `opts.persistKey` the user-driven visible/hidden state is stored
//     under Preferences using the same `{ show: bool }` shape the native
//     Inventory uses, so the panel reopens (or stays closed) across reloads.
//   - On logout, every registered handle is disposed automatically.

/** Module registry — Set of live handles. The panel's `.name` only becomes
 * available once the factory has been invoked, so we don't key by it. */
const _registry = new Set()
let _busSubscribed = false

function _ensureBusSubscriptions() {
	if (_busSubscribed) {return}
	_busSubscribed = true
	// Single shared subscription per event — dispatches to every registered
	// handle. Cheaper than one bus listener per handle.
	busOn(EVENTS.MAP_READY, () => {
		for (const h of _registry) {h._onMapReady()}
	})
	busOn(EVENTS.MAP_LEAVE, () => {
		for (const h of _registry) {h._onMapLeave()}
	})
	// Force-detach on char-enter and logout — even when `alwaysVisible` is set.
	// The user's intent : keep the panel alive across map cycles in-game, but
	// never let it survive into char-select / a different char's session. We
	// DON'T dispose here ; the handle stays alive so a re-login without page
	// reload can re-append on the next map-ready. Real disposal happens via
	// `registerCleanup` (host reinit / page unload).
	busOn(EVENTS.CHAR_ENTER, () => {
		for (const h of _registry) {h._forceDetach()}
	})
	busOn(EVENTS.LOGOUT, () => {
		for (const h of _registry) {h._forceDetach()}
	})
}

/**
 * Register a plugin-owned component that should mirror the lifecycle of native
 * windows (BasicInfo / Inventory) :
 *   - The panel is constructed lazily by invoking `panelFactory` on the first
 *     `map-ready`. This guarantees the base component class is ready — plugins
 *     don't need to gate their Init() on `map-enter` themselves.
 *   - (Re-)append on every `map-ready` (post-fade signal).
 *   - Optionally persist visibility under a Preferences key.
 *   - Force-detach on `char-enter` and `logout` (always — even when
 *     `alwaysVisible` is set). The handle stays alive ; a fresh `map-ready`
 *     re-appends it.
 *   - Real disposal happens on host `cleanup` (re-init / page unload).
 *
 * The plugin remains the OWNER of the panel's DOM (titlebar, close button,
 * drag handle — bound by the plugin itself in `opts.onMount`, which fires ONCE
 * after the first append, mirroring the native `init()` slot).
 *
 * @param {() => any} panelFactory Returns a fresh component (with `.name`).
 *                                 Invoked once at first map-ready.
 * @param {object}        [opts]
 * @param {string}        [opts.persistKey]      If set, visibility is persisted
 *                                               via `Preferences.get(key, {show}, 1.0)`.
 * @param {boolean}       [opts.defaultVisible]  Initial visibility if no stored
 *                                               prefs. Default `true`.
 * @param {boolean}       [opts.alwaysVisible]   When `true`, the panel is
 *                                               re-appended immediately after
 *                                               `UIManager.removeComponents()`
 *                                               so it stays visible through the
 *                                               loading screen + fade. Default `false`.
 * @param {() => void}    [opts.onShow]          Fired AFTER show() takes effect.
 * @param {() => void}    [opts.onHide]          Fired AFTER hide() takes effect.
 * @param {(panel: any) => void} [opts.onMount]  Fired ONCE, right after the
 *                                               first successful `panel.append()`.
 *                                               Bind drag handlers / DOM
 *                                               listeners here (NOT on every
 *                                               map-ready — the DOM node and its
 *                                               handlers survive a detach, so
 *                                               re-binding stacks handlers).
 * @returns {{
 *   show: () => void,
 *   hide: () => void,
 *   toggle: () => void,
 *   isVisible: () => boolean,
 *   getPanel: () => (any | null),
 *   dispose: () => void,
 * }} Handle for show/hide/toggle/dispose. `getPanel()` returns null until the
 *    factory has been invoked (post-map-ready).
 */
export function registerPlayerWindow(panelFactory, opts = {}) {
	if (typeof panelFactory !== 'function') {
		throw new Error('[ui] registerPlayerWindow: panelFactory must be a function returning a component')
	}

	let disposed = false
	let appended = false
	let mounted = false
	/** @type {any} */
	let panel = null
	let visible = opts.defaultVisible !== false
	let userToggled = false
	let prefsObject = null

	function _loadPrefsOnce() {
		if (!opts.persistKey || prefsObject) {return}
		try {
			const def = { show: opts.defaultVisible !== false }
			prefsObject = Preferences.get(opts.persistKey, def, 1.0)
			if (!userToggled) {visible = !!prefsObject.show}
		} catch (e) {
			console.warn(`[ui] Preferences.get failed for "${opts.persistKey}":`, e)
		}
	}

	function _applyVisibility() {
		if (!panel) {return}
		const r = root(panel)
		if (!r) {return}
		r.style.display = visible ? '' : 'none'
	}

	function _persist() {
		if (!prefsObject) {return}
		prefsObject.show = visible
		try { if (typeof prefsObject.save === 'function') {prefsObject.save()} }
		catch (e) { console.warn('[ui] Preferences.save failed:', e) }
	}

	function _ensurePanel() {
		if (panel) {return panel}
		try { panel = panelFactory() }
		catch (e) {
			console.error('[ui] panelFactory threw:', e)
			panel = null
			return null
		}
		if (!panel || !panel.name) {
			console.error('[ui] panelFactory must return a component with .name (got:', panel, ')')
			panel = null
			return null
		}
		// Dedupe : if a previous handle owns the same panel.name, dispose it.
		for (const h of _registry) {
			if (h !== handle && typeof h._panelName === 'function' && h._panelName() === panel.name) {
				h.dispose()
			}
		}
		return panel
	}

	function _doAppend() {
		if (!UIManager.components) {return}
		const p = _ensurePanel()
		if (!p) {return}
		_loadPrefsOnce()
		registerWindow(p)
		try { p.append() }
		catch (e) { console.error('[ui] panel.append failed:', e); return }
		appended = true
		_applyVisibility()
		if (!mounted && typeof opts.onMount === 'function') {
			mounted = true
			try { opts.onMount(p) }
			catch (e) { console.error('[ui] onMount handler threw:', e) }
		}
	}

	function _onMapReady() {
		if (disposed || appended) {return}
		_doAppend()
	}

	function _onMapLeave() {
		appended = false
		if (opts.alwaysVisible) {
			Promise.resolve().then(() => {
				if (disposed || appended) {return}
				_doAppend()
			})
		}
	}

	function _forceDetach() {
		if (disposed || !appended || !panel) {return}
		try { if (typeof panel.remove === 'function') {panel.remove()} }
		catch (e) { /* already detached — non-fatal */ }
		appended = false
	}

	const handle = {
		show() {
			if (disposed) {return}
			userToggled = true
			visible = true
			_applyVisibility()
			_persist()
			if (typeof opts.onShow === 'function') {
				try { opts.onShow() } catch (e) { console.error('[ui] onShow handler:', e) }
			}
		},
		hide() {
			if (disposed) {return}
			userToggled = true
			visible = false
			_applyVisibility()
			_persist()
			if (typeof opts.onHide === 'function') {
				try { opts.onHide() } catch (e) { console.error('[ui] onHide handler:', e) }
			}
		},
		toggle() { if (visible) {handle.hide()} else {handle.show()} },
		isVisible() { return visible },
		getPanel() { return panel },
		dispose() {
			if (disposed) {return}
			disposed = true
			_registry.delete(handle)
			if (panel) {
				try { if (typeof panel.remove === 'function') {panel.remove()} }
				catch (e) { /* panel may already be detached — non-fatal */ }
			}
		},
		_onMapReady,
		_onMapLeave,
		_forceDetach,
		_panelName() { return panel ? panel.name : null },
	}

	_registry.add(handle)
	_ensureBusSubscriptions()
	registerCleanup(({ reason } = {}) => {
		// On hot-reload / re-init a rebuilt instance reuses the same component
		// name. A legacy shared-stylesheet dedup guard would keep the STALE CSS
		// block — strip it here before the new instance's prepare() runs.
		if (reason === 'reload' || reason === 'reinit') {purgeComponentCss(handle._panelName())}
		handle.dispose()
	})

	// Synchronous append if the host already passed map-ready (mid-game plugin
	// load). Safe : at map-ready the base component is ready.
	if (hasReached('map-ready')) {_onMapReady()}

	return handle
}
