/**
 * packet-observer — additive listeners for RO packets, both incoming
 * (`observePacket`) and outgoing (`observeSendPacket`).
 *
 * # Incoming (observePacket)
 *
 * Why not `Network.hookPacket`: the native implementation does a destructive
 * replace (`Packets.list[id].callback = cb`). Hooking a spawn/vanish/move
 * packet that way breaks rendering — the native EntityEngine loses its handler.
 *
 * Strategy : install a getter/setter trap on `Network.read.callback` via
 * `Object.defineProperty`. Our callback stays permanent. External calls to
 * `Network.read(cb)` queue `cb` in `externalReadCb` and fire exactly once on
 * the next incoming buffer — preserves the bundle's one-shot semantics (AID on
 * login, Character.GID on map-enter).
 *
 * Each raw buffer is decoded via PACKET.ZC/CZ.X.id + PacketLength +
 * `new PacketClass(fp, endOffset)`, then `fp.seek(savePos)` rewinds so the
 * bundle's own parsing sees an untouched position.
 *
 * # Outgoing (observeSendPacket)
 *
 * # `off()` API
 *
 * Both `observePacket` and `observeSendPacket` return an `off()` function that
 * removes the registered listener (idempotent — second call no-ops). Calls
 * return `false` if the inputs were invalid.
 *
 * Wrap `Network.sendPacket(pkt)` once with a dispatcher that matches
 * `pkt.constructor` against registered packet classes. The wrapper is fully
 * transparent : it always forwards to the original sendPacket, so adding
 * observers can never block or modify outgoing traffic.
 */

import { Network, PACKET, PacketLength } from './plugin-api.js'

/** Registered listeners : packet id → array of callbacks. */
const listeners = new Map()
/** id → PacketClass. Built once, refreshed on lookup miss. */
let classMap = null
let installed = false
let classMapMissRebuilt = false
let ourCallback = null
let externalReadCb = null
let dispatchCount = 0
let installAttempts = 0

function buildClassMap() {
	classMap = {}
	if (!PACKET) {return}
	for (const nsName of Object.keys(PACKET)) {
		const ns = PACKET[nsName]
		if (!ns || typeof ns !== 'object') {continue}
		for (const k of Object.keys(ns)) {
			const c = ns[k]
			if (!c || c.id == null) {continue}
			const id = typeof c.id === 'string' ? Number(c.id) : c.id
			if (Number.isFinite(id) && id !== 0) {classMap[id] = c}
		}
	}
}

function dispatch(fp) {
	if (!classMap) {return}
	const savePos = fp.tell()
	while (fp.tell() < fp.length - 2) {
		const offset = fp.tell()
		const id = fp.readUShort()
		let length = PacketLength ? PacketLength.getPacketLength(id) : 0
		if (!length) {length = fp.length - offset}
		if (length < 0) {
			if (offset + 4 > fp.length) {break}
			length = fp.readUShort()
		}
		if (offset + length > fp.length) {break}
		const cbs = listeners.get(id)
		if (cbs) {
			let cls = classMap[id]
			if (!cls && !classMapMissRebuilt) {
				classMapMissRebuilt = true
				buildClassMap()
				cls = classMap[id]
			}
			if (cls) {
				try {
					const instance = new cls(fp, offset + length)
					for (const entry of cbs) {
						try { entry.cb(instance) } catch (e) { console.error('[RO][observePacket] cb:', e) }
					}
				} catch (e) { console.error('[RO][observePacket] parse:', e) }
			}
		}
		fp.seek(offset + length, 0)
	}
	fp.seek(savePos, 0)
}

function trapReadCallback(readFn) {
	if (!readFn || readFn.__roObserverTrapped) {return}
	try {
		Object.defineProperty(readFn, 'callback', {
			get() { return ourCallback },
			set(v) { if (v && v !== ourCallback) {externalReadCb = v} },
			configurable: true,
		})
		readFn.__roObserverTrapped = true
	} catch (e) {
		console.error('[RO][observePacket] defineProperty on read.callback failed, falling back to poll:', e)
		setInterval(() => {
			if (readFn.callback !== ourCallback) {readFn(ourCallback)}
		}, 100)
	}
}

function install() {
	if (installed) {return}
	const readFn = Network && Network.read
	if (typeof readFn !== 'function') {
		installAttempts++
		if (installAttempts === 1) {console.log('[RO][observePacket] Network.read not ready, retrying every 100ms…')}
		setTimeout(install, 100)
		return
	}
	installed = true
	buildClassMap()

	ourCallback = (fp) => {
		dispatchCount++
		try { dispatch(fp) } catch (e) { console.error('[RO][observePacket] dispatch error:', e) }
		if (externalReadCb) {
			const cb = externalReadCb
			externalReadCb = null
			try { cb(fp) } catch (e) { console.error('[RO][observePacket] external read cb error:', e) }
		}
	}
	trapReadCallback(readFn)

	// The bundle swaps Network.read between servers (login → char → map).
	// Re-trap the `.callback` slot on every new read function it assigns.
	try {
		let currentRead = readFn
		Object.defineProperty(Network, 'read', {
			get() { return currentRead },
			set(fn) {
				currentRead = fn
				if (typeof fn === 'function') {
					trapReadCallback(fn)
					console.log('[RO][observePacket] Network.read reassigned — re-trapped callback on new read function')
				}
			},
			configurable: true,
		})
	} catch (e) {
		console.warn('[RO][observePacket] defineProperty on Network.read failed — server-switch packets may be missed:', e)
	}

	console.log(`[RO][observePacket] observer installed (attempts=${ installAttempts + 1 }, listeners=${ listeners.size })`)
}

/**
 * Additive listener. Multiple per packet allowed.
 *
 * Returns an `off()` function that removes this specific listener (idempotent).
 * Returns `false` if the inputs are invalid (no listener registered).
 *
 * @returns {(() => boolean) | false}
 */
export function observePacket(packetClass, callback) {
	const rawId = packetClass && packetClass.id
	if (!rawId || typeof callback !== 'function') {return false}
	const id = typeof rawId === 'string' ? Number(rawId) : rawId
	if (!Number.isFinite(id) || id === 0) {return false}
	if (!listeners.has(id)) {listeners.set(id, [])}
	const arr = listeners.get(id)
	const entry = { cb: callback }
	arr.push(entry)
	install()
	return function off() {
		const i = arr.indexOf(entry)
		if (i < 0) {return false}
		arr.splice(i, 1)
		return true
	}
}

/** Diagnostic — safe to call before bundle is ready. */
export function observePacketStatus() {
	const readFn = Network && Network.read
	return {
		installed,
		dispatchCount,
		listenerCount: listeners.size,
		classMapSize: classMap ? Object.keys(classMap).length : 0,
		readCallbackBound: !!ourCallback && typeof readFn === 'function' && readFn.callback === ourCallback,
		externalQueued: !!externalReadCb,
		// Outgoing diagnostics
		sendInstalled,
		sendDispatchCount,
		sendListenerCount: sendListeners.size,
	}
}

// ── Outgoing packet observer ──────────────────────────────────────────

/** Map<packetClass, callbacks[]> — registered listeners for outgoing pkts. */
const sendListeners = new Map()
let sendInstalled = false
let sendInstallAttempts = 0
/** Saved original Network.sendPacket — captured once, restored never. */
let sendOriginal = null
let sendDispatchCount = 0

function installSendTrap() {
	if (sendInstalled) {return}
	const fn = Network && Network.sendPacket
	if (typeof fn !== 'function') {
		sendInstallAttempts++
		if (sendInstallAttempts === 1) {
			console.log('[RO][observeSendPacket] Network.sendPacket not ready, retrying every 100ms…')
		}
		setTimeout(installSendTrap, 100)
		return
	}
	sendInstalled = true
	sendOriginal = fn
	const wrapper = function sendPacketTrap(pkt) {
		// Dispatch BEFORE forwarding so listeners can react synchronously
		// (e.g. release a gate that depends on outgoing-packet detection).
		// Wrapped in try/catch so a buggy listener can't break the send.
		if (pkt && pkt.constructor) {
			const cbs = sendListeners.get(pkt.constructor)
			if (cbs && cbs.length) {
				sendDispatchCount++
				for (const entry of cbs) {
					try { entry.cb(pkt) } catch (e) { console.error('[RO][observeSendPacket] cb:', e) }
				}
			}
		}
		return sendOriginal.apply(this, arguments)
	}
	wrapper.__roObserverSend = true
	try {
		Network.sendPacket = wrapper
		console.log(`[RO][observeSendPacket] outgoing trap installed (attempts=${ sendInstallAttempts + 1 }, listeners=${ sendListeners.size })`)
	} catch (e) {
		sendInstalled = false
		console.warn('[RO][observeSendPacket] failed to install Network.sendPacket wrapper:', e)
	}
}

/**
 * Additive listener for OUTGOING packets. Multiple per packet class allowed.
 *
 * @param {Function} packetClass  e.g. `PACKET.CZ.REQUEST_QUIT`
 * @param {(pkt: object) => void} callback  invoked synchronously, before the
 *   original `Network.sendPacket` forwards. Errors are caught and logged so a
 *   bad listener can't block the send.
 * @returns {(() => boolean) | false} `off()` removes this listener (idempotent),
 *   `false` if inputs invalid.
 */
export function observeSendPacket(packetClass, callback) {
	if (typeof packetClass !== 'function' || typeof callback !== 'function') {return false}
	if (!sendListeners.has(packetClass)) {sendListeners.set(packetClass, [])}
	const arr = sendListeners.get(packetClass)
	const entry = { cb: callback }
	arr.push(entry)
	installSendTrap()
	return function off() {
		const i = arr.indexOf(entry)
		if (i < 0) {return false}
		arr.splice(i, 1)
		return true
	}
}
