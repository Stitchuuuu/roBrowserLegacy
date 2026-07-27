/**
 * event-bus — tiny publish/subscribe bus for the native plugin host.
 *
 * Ported from the v3 framework's event-bus lib. **Module-pure singleton**: a
 * single bus is created at module evaluation. Direct exports (`on`, `off`,
 * `once`, `emit`, `onFirstListener`) operate on this singleton so consumers
 * don't need a reference object — the native DI map exposes them flattened.
 *
 * **`EVENTS` catalogue**: frozen object listing every event name emitted on
 * the bus by the native libs (lifecycle phases + native function traps).
 * Consumers reference `EVENTS.MAP_READY` etc. rather than hard-coding strings
 * — the catalogue is the single source of truth.
 *
 * The factory `createBus(opts)` is still exported for tests and standalone
 * use cases that want their own isolated bus.
 *
 * Iteration snapshots the Set via spread, which makes it safe for a handler
 * to unsubscribe itself (or others) mid-dispatch.
 */

export function createBus(opts) {
	const m = new Map() // event → Set<cb>
	const firstListenerHooks = new Map() // event → callback fired on first sub

	// Optional `logger = { log, warn, error }` — when provided, error paths
	// route through a richer logger. Falls back to plain console.error so the
	// lib stays usable standalone.
	const error = (opts && opts.logger && opts.logger.error) || ((msg, extra) => {
		if (extra !== undefined) { console.error(msg, extra) }
		else { console.error(msg) }
	})

	function on(event, cb) {
		let set = m.get(event)
		const wasEmpty = !set || set.size === 0
		if (!set) { set = new Set(); m.set(event, set) }
		set.add(cb)
		if (wasEmpty && firstListenerHooks.has(event)) {
			try { firstListenerHooks.get(event)() }
			catch (e) { error(`[NativePM bus first-listener:${event}]`, e) }
		}
		return () => off(event, cb)
	}

	function off(event, cb) {
		const set = m.get(event)
		if (!set) {return}
		set.delete(cb)
		if (set.size === 0) {m.delete(event)}
	}

	function once(event, cb) {
		const unsub = on(event, (...args) => { unsub(); cb(...args) })
		return unsub
	}

	function emit(event, ...args) {
		const set = m.get(event)
		if (!set) {return}
		for (const cb of [...set]) {
			try { cb(...args) }
			catch (e) { error(`[NativePM bus:${event}]`, e) }
		}
	}

	/**
	 * Register a one-shot hook that fires the first time someone subscribes
	 * to `event` via `on()`. If listeners already exist when the hook is
	 * registered, fires immediately. Used by lazy observers (packet-observer,
	 * socket-observer) to install their global trap only when a consumer
	 * appears.
	 */
	function onFirstListener(event, cb) {
		firstListenerHooks.set(event, cb)
		const set = m.get(event)
		if (set && set.size > 0) {
			try { cb() }
			catch (e) { error(`[NativePM bus first-listener:${event}]`, e) }
		}
	}

	function stats() {
		let listeners = 0
		for (const set of m.values()) {listeners += set.size}
		return { events: m.size, listeners }
	}

	return { on, off, once, emit, stats, onFirstListener }
}

// ── Module-pure singleton ──
const _bus = createBus()

export const on = _bus.on
export const off = _bus.off
export const once = _bus.once
export const emit = _bus.emit
export const onFirstListener = _bus.onFirstListener
export const stats = _bus.stats
export function getBus() { return _bus }

/**
 * Catalogue of every event name emitted on the bus by the native libs.
 * Single source of truth — reference `EVENTS.MAP_READY` over hard-coding
 * the string. Keep in sync with the libs that emit/transition.
 */
export const EVENTS = Object.freeze({
	// Lifecycle phases (emitted by lifecycle.transition)
	CHAR_SELECT:       'char-select',
	CHAR_ENTER:        'char-enter',
	MAP_ENTER:         'map-enter',
	MAP_LEAVE:         'map-leave',
	MAP_READY:         'map-ready',
	LOGOUT:            'logout',
	CLEANUP:           'cleanup',
	WIRE_COMPLETE:     'wire-complete',
	// Native function traps (emitted by lifecycle's runtime wrappers)
	BACKGROUND_REMOVE: 'background-remove',
})
