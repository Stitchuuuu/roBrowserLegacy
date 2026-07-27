/**
 * lifecycle — framework/plugin lifecycle phases + cleanup handlers + the
 * packet-driven wiring that drives them.
 *
 * **Module-pure singleton**: a single lifecycle is created at module
 * evaluation, importing the bus singleton from the event-bus module. Direct
 * exports (`getState`, `hasReached`, `transition`, `registerCleanup`, …)
 * operate on this singleton.
 *
 * **Packet wiring**: at module eval it starts polling the PACKET module until
 * the client exposes HC/ZC, then binds :
 *
 *   - HC.ACCEPT_ENTER*         → 'char-select'
 *   - HC.NOTIFY_ZONESVR*       → 'char-enter'
 *   - ZC.ACCEPT_ENTER* + NPCACK_MAPMOVE (debounced) → 'map-enter'/'map-leave'
 *   - ZC.DISCONNECTED*         → 'logout'
 *
 * Plus a socket-close fallback via the socket-observer module and an AID
 * safety poll via `Session.AID`. Once wiring completes it emits
 * `'wire-complete'` on the bus so consumers can hook on it.
 *
 * Phases :
 *   - pre-boot    : initial state (before module eval completes)
 *   - boot        : host ready, libs loaded (pre-login) — **silent, no event**
 *   - char-select : HC.ACCEPT_ENTER packet received
 *   - char-enter  : HC.NOTIFY_ZONESVR packet received
 *   - map-enter   : ZC.ACCEPT_ENTER packet received (may re-fire on map change)
 *   - map-leave   : ZC.NPCACK_MAPMOVE packet received (may re-fire)
 *   - map-ready   : DOM stable post-fade — derived from the 'background-remove'
 *                   trap, fires once per map after the loading-screen fade
 *                   completes. This is when the native BasicInfo/Inventory/etc.
 *                   are re-appended by the engine, so it's the right moment for
 *                   plugin windows to mount. Outside PHASE_ORDER (cyclic).
 *   - logout      : ZC.RESTART or socket close (via socket-observer)
 *   - cleanup     : emitted with `{reason: 'reinit' | 'unload'}`
 *
 * Generic native-event channel :
 *   - background-remove : runtime trap on native `Background.remove(cb)`,
 *                         emitted on the bus AFTER the user callback returns.
 *                         `lifecycle` itself derives `map-ready` from this.
 *
 * `'boot'` does NOT emit on the bus — plugins read it via `hasReached('boot')`.
 *
 * The cleanup registry fires :
 *   - with `{reason: 'reinit'}` before each plugin Init re-call (count > 1)
 *   - with `{reason: 'unload'}` on page unload
 *
 * The factory `createLifecycle(bus, opts)` is still exported for tests and
 * standalone use cases that want their own isolated lifecycle.
 */

import { emit as _emit, on as _on, EVENTS } from './event-bus.js'
import { PACKET, Session, Background, UIComponent } from './plugin-api.js'
import { observePacket } from './packet-observer.js'
import { observeSocket, observeSocketStatus } from './socket-observer.js'

const PHASE_ORDER = ['boot', 'char-select', 'char-enter', 'map-enter', 'map-leave']

// ── Mutable logger holder ──
// Declared BEFORE the singleton creation so the lazy-shim passed to
// `createLifecycle({verbose, logger.error})` can resolve `_logger` out of TDZ.
// `setLogger()` mutates the fields in place — the shim closure references this
// object by identity.
//
// Native default: `log` and `verbose` are NO-OPs so the phase/wiring trace
// stays off the console (transitions fire on every login/logout/map-change —
// too noisy). `warn`/`error` stay live. `setLogger()` can enable a richer
// logger for debugging.
const _logger = {
	log:     () => {},
	warn:    (m) => console.warn(m),
	error:   (m, e) => { if (e !== undefined) {console.error(m, e);} else {console.error(m)} },
	verbose: () => {},
}

/**
 * Inject a richer logger (e.g. ring-buffered) — enables the phase/wiring trace.
 */
export function setLogger(l) {
	if (!l || typeof l !== 'object') {return}
	if (typeof l.log === 'function') {_logger.log = l.log}
	if (typeof l.warn === 'function') {_logger.warn = l.warn}
	if (typeof l.error === 'function') {_logger.error = l.error}
	if (typeof l.verbose === 'function') {_logger.verbose = l.verbose}
}

export function createLifecycle(bus, opts) {
	// `bus` may be `null` if caller wants a no-op bus (rare). Default emit
	// resolves to noop in that case so transitions still set state.
	const emit = (bus && bus.emit) ? bus.emit.bind(bus) : (() => {})

	const verbose = (opts && opts.verbose) || ((msg, style) => {
		if (style) { console.log(`%c${ msg}`, style) }
		else { console.log(msg) }
	})
	const error = (opts && opts.logger && opts.logger.error) || ((msg, extra) => {
		if (extra !== undefined) { console.error(msg, extra) }
		else { console.error(msg) }
	})

	let state = 'pre-boot'
	let count = 0
	const reached = new Set()
	// owner = plugin name string captured at registerCleanup() time, or null
	// for unowned (cleanup registered outside any plugin init — module-eval).
	// Unowned cleanups only flush on global flushCleanup ('reinit' / 'unload').
	const cleanups = [] // [{ cb, owner }]
	let _currentPlugin = null  // set by the registry around each plugin init

	function setCurrentPlugin(name) {
		_currentPlugin = name
	}

	function transition(phase) {
		const prev = state
		const idx = PHASE_ORDER.indexOf(phase)
		if (idx >= 0) {
			for (let i = 0; i <= idx; i++) {reached.add(PHASE_ORDER[i])}
		} else {
			reached.add(phase)
		}
		state = phase
		verbose(`[NativePM lifecycle] ${prev} → ${phase}`, 'color:#0af;font-weight:bold')
		// 'boot' is silent — plugins use hasReached('boot') instead.
		if (phase !== 'boot') {emit(phase)}
	}

	function onInitCall() {
		count++
		if (count > 1) {flushCleanup('reinit')}
	}

	function flushCleanup(reason, ownerFilter) {
		emit(EVENTS.CLEANUP, { reason, owner: ownerFilter || null })
		if (ownerFilter) {
			// Selective flush : only cleanups owned by the named plugin.
			const matches = []
			const survivors = []
			for (const entry of cleanups) {
				if (entry.owner === ownerFilter) {matches.push(entry)}
				else {survivors.push(entry)}
			}
			cleanups.length = 0
			cleanups.push(...survivors)
			for (const { cb } of matches) {
				try { cb({ reason }) }
				catch (e) { error('[NativePM lifecycle cleanup]', e) }
			}
		} else {
			// Global flush — used by 'reinit' (map reload) and 'unload' (pagehide).
			const old = cleanups.splice(0)
			for (const { cb } of old) {
				try { cb({ reason }) }
				catch (e) { error('[NativePM lifecycle cleanup]', e) }
			}
		}
	}

	function registerCleanup(cb) {
		const entry = { cb, owner: _currentPlugin }  // capture owner at registration
		cleanups.push(entry)
		return () => {
			const i = cleanups.indexOf(entry)
			if (i >= 0) {cleanups.splice(i, 1)}
		}
	}

	return {
		get state() { return state },
		get count() { return count },
		hasReached(phase) { return reached.has(phase) },
		transition,
		onInitCall,
		registerCleanup,
		flushCleanup,
		setCurrentPlugin,
		cleanupCount() { return cleanups.length },
		stats() {
			return { state, count, reached: [...reached], cleanups: cleanups.length }
		},
	}
}

// ── Module-pure singleton ──
const _lifecycle = createLifecycle(
	{ emit: _emit },
	{
		verbose: (msg, style) => _logger.verbose(msg, style),
		logger:  { error: (msg, e) => _logger.error(msg, e) },
	},
)
_lifecycle.transition('boot') // silent (boot doesn't emit) — sets state + reached

if (typeof addEventListener === 'function') {
	// 'pagehide' (not 'beforeunload') : only fires on a real unload. The
	// !persisted guard skips bfcache navigations that may return.
	addEventListener('pagehide', (e) => { if (!e.persisted) _lifecycle.flushCleanup('unload') })
}

export const transition = _lifecycle.transition
export const onInitCall = _lifecycle.onInitCall
export const registerCleanup = _lifecycle.registerCleanup
export const flushCleanup = _lifecycle.flushCleanup
// Called by the registry around each plugin init to scope subsequent
// registerCleanup() calls to the currently-initializing plugin.
export const setCurrentPlugin = (name) => { _lifecycle.setCurrentPlugin(name) }
export function getState() { return _lifecycle.state }
export function getCount() { return _lifecycle.count }
export function hasReached(phase) { return _lifecycle.hasReached(phase) }
export function cleanupCount() { return _lifecycle.cleanupCount() }
export function stats() { return _lifecycle.stats() }
export function getLifecycle() { return _lifecycle }

// ── Packet-driven wiring ──

let _wired = false
const _wireStart = performance.now()
let _fallbackAttempts = 0

function _wirePackets() {
	if (_wired) {return false}
	// PACKET is the packet-structure module. Read it once and probe the
	// expected namespaces (populated as the client evaluates its packet defs).
	const P = PACKET
	if (!P || !P.ZC || !P.HC) {return false}
	_wired = true
	const elapsed = Math.round(performance.now() - _wireStart)
	_logger.log(`[NativePM lifecycle] PACKET ready after ${elapsed}ms, wiring now`, 'color:#888')

	// Bind EVERY matching class — the client registers multiple packet-version
	// classes but the server only sends one. transition() cascades idempotently
	// so duplicate bindings are safe.
	function wireAll(ns, names, phase) {
		if (!ns) {return 0}
		const bound = []
		for (const n of names) {
			if (ns[n]) {
				observePacket(ns[n], () => transition(phase))
				bound.push(n)
			}
		}
		if (bound.length > 0) {
			_logger.log(`[NativePM lifecycle][wire] ${phase} ← ${bound.join(', ')}`, 'color:#888')
		} else {
			_logger.warn(`[NativePM lifecycle] no packet class found for ${phase} — tried: ${names.join(', ')}`)
		}
		return bound.length
	}
	wireAll(P.HC, ['ACCEPT_ENTER', 'ACCEPT_ENTER2', 'ACCEPT_ENTER3', 'ACCEPT_ENTER_NEO_UNION'], 'char-select')
	wireAll(P.HC, ['NOTIFY_ZONESVR', 'NOTIFY_ZONESVR2', 'NOTIFY_ZONESVR3'], 'char-enter')

	// Map transitions :
	// - First map load (from char-select) fires both ACCEPT_ENTER2 and
	//   NPCACK_MAPMOVE within ~1ms.
	// - Subsequent warps fire ONLY NPCACK_MAPMOVE.
	// No dedicated map-leave packet; emit synthetically just before the second+
	// map-enter. Debounce 500ms for the first-load double-fire.
	let lastMapEnter = 0
	function onMapEnterPacket() {
		const now = performance.now()
		if (now - lastMapEnter < 500) {return}
		lastMapEnter = now
		if (_lifecycle.hasReached('map-enter')) {
			transition('map-leave')
		}
		transition('map-enter')
		// Two parallel attempts to install map-ready signal sources. First
		// successful one wins ; second one is a no-op (Symbol-guard).
		_armBackgroundRemoveTrap('map-enter')
		_armUIComponentAppendObserver()
		// Fallback timer : if the Background.remove trap didn't install or its
		// callback never fires, force map-ready 2.5s after map-enter so
		// consumers don't deadlock waiting on the phase.
		if (_mapReadyFallbackTimer) {clearTimeout(_mapReadyFallbackTimer)}
		_mapReadyFallbackTimer = setTimeout(() => _fireMapReady('fallback-timer'), 2500)
	}
	function wireMapEntry(names) {
		const bound = []
		for (const n of names) {
			if (P.ZC && P.ZC[n]) {
				observePacket(P.ZC[n], onMapEnterPacket)
				bound.push(n)
			}
		}
		if (bound.length > 0) {
			_logger.log(`[NativePM lifecycle][wire] map-enter/map-leave ← ${bound.join(', ')}`, 'color:#888')
		} else {
			_logger.warn(`[NativePM lifecycle] no map entry packet found — tried: ${names.join(', ')}`)
		}
	}
	wireMapEntry(['ACCEPT_ENTER', 'ACCEPT_ENTER2', 'ACCEPT_ENTER3', 'MAP_AUTHOK', 'NPCACK_MAPMOVE'])

	// Logout fallback channel — primary is the socket-close wrapper below. Kept
	// in case a server exposes a dedicated packet.
	wireAll(P.ZC, ['DISCONNECTED', 'NOTIFY_PLAYER_DEAD', 'QUIT_ACK'], 'logout')

	// Socket-based logout detection — subscribed HERE (not at module eval) so
	// the multiplex factory install doesn't race the network manager's own
	// init. By the time PACKET is populated, NetworkManager has finished its
	// init and is stable enough to accept a factory swap.
	observeSocket(({ type, host, port }) => {
		if (type === 'open') {
			_logger.verbose(`[NativePM lifecycle][socket] new socket ${host}:${port}`, 'color:#888')
			return
		}
		_logger.verbose(`[NativePM lifecycle][socket] close ${host}:${port}`, 'color:#c66')
		setTimeout(() => {
			if (_lifecycle.state === 'logout') {return}
			if (observeSocketStatus().openSocketCount === 0) {
				_logger.log('[NativePM lifecycle][socket] all sockets closed — firing logout', 'color:#c66')
				transition('logout')
			}
		}, 500)
	})

	// AID fallback — safety net in case the socket wrapper misses a disconnect.
	let lastAID = null
	setInterval(() => {
		const aid = Session && Session.AID
		if (aid && aid !== lastAID) {
			lastAID = aid
			_logger.verbose(`[NativePM lifecycle][session] AID set: ${aid}`, 'color:#888')
		} else if (lastAID && !aid && !_lifecycle.hasReached('logout')) {
			_logger.log('[NativePM lifecycle][session] AID cleared — inferring logout', 'color:#c66')
			transition('logout')
			lastAID = null
		}
	}, 1000)

	// `BACKGROUND_REMOVE` is the generic post-fade signal — fired by either the
	// Background.remove trap OR the UIComponent.append observer. lifecycle
	// derives `map-ready` from it.
	_on(EVENTS.BACKGROUND_REMOVE, () => _fireMapReady('background-remove'))

	// Path 1 : Background.remove trap — precise. Three attempts on lifecycle
	// phases (native Background is a static import, so this normally installs
	// on the first attempt).
	_armBackgroundRemoveTrap('wire-complete')
	_on(EVENTS.CHAR_ENTER, () => _armBackgroundRemoveTrap('char-enter'))

	// Path 2 : UIComponent.append observer — fallback. Fires when no append()
	// call occurs for 200ms post-map-leave, signalling the burst of native
	// window re-mounts has settled.
	_armUIComponentAppendObserver()
	_on(EVENTS.CHAR_ENTER, () => _armUIComponentAppendObserver())

	// Notify consumers.
	_emit(EVENTS.WIRE_COMPLETE, { P })

	return true
}

// ── map-ready : post-fade signal via Background.remove trap ──
//
// Native sequence on every map change :
//   1. NPCACK_MAPMOVE    → MapEngine.onMapChange       (we transition map-enter)
//   2. MapRenderer.setMap() → UIManager.removeComponents() (DOM wiped)
//   3. Background.setLoading() → loading screen fades in
//   4. worker parses .gat/.rsw + GPU upload
//   5. Background.remove(cb) → fade-out animation
//   6. cb() runs → MapRenderer.onLoad() → BasicInfo.append() + others
//
// Wrapping `Background.remove` lets us emit a generic `'background-remove'`
// event AFTER cb() — the precise moment native windows are stable. lifecycle
// derives `map-ready` from that event ; consumers can also subscribe directly
// via `bus.on(EVENTS.BACKGROUND_REMOVE, cb)` for non-phase use cases.
//
// Background.remove is also called without a callback in other paths (login
// flow, some logout paths). The map-ready guard `state === 'map-enter'` rejects
// those — only fires when we're between map-enter and the first fade-end.

const MAP_READY_GUARD = Symbol.for('native-manager/lifecycle:bg-remove-wrapped')
let _mapReadyFallbackTimer = null
let _trapInstalled = false

/**
 * Wrap `Background.remove` so its callback is followed by an emit on the bus.
 * Returns true on success, logs the reason on failure.
 */
function _armBackgroundRemoveTrap(source) {
	if (_trapInstalled) {return true}
	const bg = Background
	if (!bg) {
		if (source === 'char-enter' || source === 'map-enter') {
			_logger.warn(`[NativePM lifecycle] Background.remove trap : Background module unavailable (source=${source})`)
		}
		return false
	}
	if (typeof bg.remove !== 'function') {
		_logger.warn(`[NativePM lifecycle] Background.remove trap : .remove is ${typeof bg.remove}, not function (source=${source})`)
		return false
	}
	if (bg.remove[MAP_READY_GUARD]) {_trapInstalled = true; return true}
	const original = bg.remove
	function wrapped(cb) {
		return original.call(bg, function () {
			try { if (typeof cb === 'function') {cb.apply(this, arguments)} }
			finally { _emit(EVENTS.BACKGROUND_REMOVE) }
		})
	}
	wrapped[MAP_READY_GUARD] = true
	bg.remove = wrapped
	_trapInstalled = true
	_logger.log(`[NativePM lifecycle] Background.remove trap installed (source=${source})`, 'color:#0af;font-weight:bold')
	return true
}

function _fireMapReady(source) {
	if (_mapReadyFallbackTimer) {
		clearTimeout(_mapReadyFallbackTimer)
		_mapReadyFallbackTimer = null
	}
	// Strict guard : only when we're freshly arrived in map. Rejects login-flow
	// Background.remove() calls (state='boot') and logout calls (state='logout').
	if (_lifecycle.state !== 'map-enter') {return}
	_logger.verbose(`[NativePM lifecycle] map-ready (${source})`, 'color:#0af')
	transition('map-ready')
}

// ── UIComponent.append observer ──
//
// Alternative path to fire `BACKGROUND_REMOVE` when the Background.remove trap
// can't install. Strategy : intercept every `UIComponent.prototype.append()`
// call and debounce 200ms. When the burst of native-window appends (BasicInfo,
// Inventory, ChatBox, …) settles, the natives have finished re-mounting → fire
// map-ready.

const APPEND_GUARD = Symbol.for('native-manager/lifecycle:uic-append-wrapped')
let _appendDebounceTimer = null
let _appendObserverInstalled = false

function _armUIComponentAppendObserver() {
	if (_appendObserverInstalled) {return true}
	const UIC = UIComponent
	if (!UIC || !UIC.prototype) {return false}
	const proto = UIC.prototype
	if (typeof proto.append !== 'function') {return false}
	if (proto.append[APPEND_GUARD]) {_appendObserverInstalled = true; return true}
	const original = proto.append
	function wrapped() {
		const result = original.apply(this, arguments)
		// Only debounce-fire between map-leave and map-enter — outside that
		// window, append() calls are user-driven and irrelevant to map-ready.
		const s = _lifecycle.state
		if (s === 'map-leave' || s === 'map-enter') {
			if (_appendDebounceTimer) {clearTimeout(_appendDebounceTimer)}
			_appendDebounceTimer = setTimeout(() => {
				_appendDebounceTimer = null
				_emit(EVENTS.BACKGROUND_REMOVE)
			}, 200)
		}
		return result
	}
	wrapped[APPEND_GUARD] = true
	proto.append = wrapped
	_appendObserverInstalled = true
	_logger.log('[NativePM lifecycle] UIComponent.append observer installed (map-ready alternative)', 'color:#0af;font-weight:bold')
	return true
}

// Primary wiring mechanism — poll PACKET every 500ms up to 30s. Worst-case
// latency between eval and wiring = 500ms, fine because the first
// lifecycle-relevant packets are always preceded by a user action.
function _fallbackPoll() {
	if (_wired) {return}
	if (_wirePackets()) {return}
	_fallbackAttempts++
	if (_fallbackAttempts >= 60) {
		_logger.warn('[NativePM lifecycle] PACKET never became ready after 30s — packet transitions abandoned')
		return
	}
	setTimeout(_fallbackPoll, 500)
}
// Defer one tick so a setLogger() call right after module load lands before
// the first poll iteration.
setTimeout(_fallbackPoll, 0)

export function isWired() { return _wired }
