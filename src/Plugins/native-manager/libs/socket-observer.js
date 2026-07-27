/**
 * socket-observer — additive multi-subscriber observer for Network sockets.
 *
 * Why not call `Network.setSocketFactory` directly: the upstream API holds
 * exactly ONE factory. If a plugin installs its own, ours stops tracking. This
 * lib installs ONE factory that multiplexes to many listeners — the manager
 * and plugins can co-exist instead of stomping each other.
 *
 * Strategy : wrap `Network.setSocketFactory` once. Our factory calls
 * `Network.defaultSocketFactory(host, port)` then traps the returned socket's
 * `onClose` (assigned right after by NetworkManager.connect) so subscribers
 * receive `'close'` AFTER the native handler runs.
 *
 * Lazy install by default — the factory is only set up when :
 *   - a consumer calls `observeSocket(cb)` (first call triggers install), OR
 *   - someone subscribes to `'logout'` on the event bus (auto-detected via
 *     `onFirstListener('logout', install)`).
 */

import { Network } from './plugin-api.js'
import { onFirstListener } from './event-bus.js'

const listeners = new Set()
const capturedSockets = new Set()
let installed = false
let installAttempts = 0

function fireEvent(event) {
	for (const cb of [...listeners]) {
		try { cb(event) }
		catch (e) { console.error('[RO][observeSocket] cb:', e) }
	}
}

function install() {
	if (installed) {return}
	// If the bundle hasn't finished evaluating, setSocketFactory may be
	// undefined → retry every 100ms.
	if (!Network || typeof Network.setSocketFactory !== 'function'
		|| typeof Network.defaultSocketFactory !== 'function') {
		installAttempts++
		if (installAttempts === 1) {
			console.log('[RO][observeSocket] Network.setSocketFactory not ready, retrying every 100ms…')
		}
		setTimeout(install, 100)
		return
	}
	installed = true

	Network.setSocketFactory(function multiplexSocketFactory(host, port) {
		const sock = Network.defaultSocketFactory(host, port)
		capturedSockets.add(sock)
		fireEvent({ type: 'open', sock, host, port })

		// Trap `onClose` — NetworkManager.connect() assigns it right after we
		// return. Wrap so our subscribers fire AFTER the native handler.
		let nativeOnClose = null
		Object.defineProperty(sock, 'onClose', {
			get() { return nativeOnClose },
			set(fn) {
				nativeOnClose = function wrappedOnClose() {
					const result = fn ? fn.apply(this, arguments) : undefined
					fireEvent({ type: 'close', sock, host, port })
					return result
				}
			},
			configurable: true,
		})

		return sock
	})

	console.log('[RO][observeSocket] observer installed (multiplex factory active)')
}

/**
 * Subscribe to socket lifecycle events.
 *   cb({ type: 'open' | 'close', sock, host, port })
 * Returns an unsub.
 *
 * Triggers `install()` on first call if the factory isn't up yet.
 */
export function observeSocket(cb) {
	install()
	listeners.add(cb)
	return () => listeners.delete(cb)
}

/** Diagnostic — safe to call before install. */
export function observeSocketStatus() {
	let openCount = 0
	for (const s of capturedSockets) {if (s.connected) {openCount++}}
	return {
		installed,
		listenerCount: listeners.size,
		socketCount: capturedSockets.size,
		openSocketCount: openCount,
	}
}

/** Escape hatch — the raw Set of captured sockets. */
export function getCapturedSockets() { return capturedSockets }

// Auto-install if a consumer subscribes to 'logout' on the bus. Covers the
// logout-detection path without needing an explicit wire-up.
onFirstListener('logout', install)
