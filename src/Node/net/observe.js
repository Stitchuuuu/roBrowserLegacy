/**
 * Node/net/observe.js
 *
 * Additive multi-subscriber packet listener — Node port of the proven
 * robrowser packet-observer (same mechanism, same API).
 *
 * Why not `Network.hookPacket`: the native hook does
 *   Packets.list[packet.id].callback = callback
 * — a destructive single-slot overwrite. observePacket lets several
 * subscribers listen to the same opcode without stealing the slot.
 *
 * Strategy: intercept `Network.read.callback` with Object.defineProperty.
 * Our callback is permanent (the getter always returns it). Any external
 * `Network.read(cb)` call is queued in `externalReadCb` and executed once
 * on the next buffer — preserving the one-shot semantics the handshake
 * relies on (AID prefix on char connect, Character.GID on old-packetver
 * map connect).
 *
 * The raw buffer is re-parsed with PacketLength.getPacketLength +
 * `new PacketClass(fp, endOffset)`; fp.seek(savePos) restores the reader
 * position so the native parsing that follows is unchanged.
 */
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import PacketLength from 'Network/PacketLength.js';

const listeners = new Map(); // packetId → [cb, ...]
const anyListeners = []; // catch-all taps — every inbound packet (debug logging)
let classMap = null; // id → PacketClass, built once at install
let installed = false;
let classMapMissRebuilt = false; // retry flag if an id misses the lookup
let ourCallback = null;
let externalReadCb = null;
let dispatchCount = 0;

// All PACKET.*.id are set by NetworkManager's module-init registration
// loop, which ran when Network was imported above. AC/HC groups are
// included (unlike the in-browser original) so the login/char handshake
// packets are observable too.
function buildClassMap() {
	classMap = {};
	for (const ns of [PACKET.AC, PACKET.HC, PACKET.ZC, PACKET.CZ]) {
		if (!ns) {
			continue;
		}
		for (const k in ns) {
			const c = ns[k];
			if (!c || c.id == null) {
				continue;
			}
			// Normalise to number (.id is stored as a decimal string —
			// it comes from Object.keys(PacketRegister)).
			const id = typeof c.id === 'string' ? Number(c.id) : c.id;
			if (Number.isFinite(id) && id !== 0) {
				classMap[id] = c;
			}
		}
	}
}

function dispatch(fp) {
	if (!classMap) {
		return;
	}
	const savePos = fp.tell();
	while (fp.tell() < fp.length - 2) {
		const offset = fp.tell();
		const id = fp.readUShort();
		let length = PacketLength.getPacketLength(id);
		if (!length) {
			length = fp.length - offset; // fallback rest-of-buffer
		}
		if (length < 0) {
			if (offset + 4 > fp.length) {
				break;
			}
			length = fp.readUShort();
		}
		if (offset + length > fp.length) {
			break;
		}
		const cbs = listeners.get(id);
		if (cbs || anyListeners.length) {
			// O(1) lookup. Rare miss → rebuild once (packet registered
			// after our install, improbable).
			let cls = classMap[id];
			if (!cls && !classMapMissRebuilt) {
				classMapMissRebuilt = true;
				buildClassMap();
				cls = classMap[id];
			}
			if (cls) {
				try {
					const instance = new cls(fp, offset + length);
					if (cbs) {
						for (const cb of cbs) {
							try {
								cb(instance);
							} catch (e) {
								console.error('[observePacket] cb:', e);
							}
						}
					}
					notifyAny(id, cls.name, instance);
				} catch (e) {
					console.error('[observePacket] parse:', e);
					notifyAny(id, cls && cls.name, null);
				}
			} else {
				notifyAny(id, null, null); // unknown packet — still report the opcode
			}
		}
		fp.seek(offset + length, 0); // SEEK_SET = 0
	}
	fp.seek(savePos, 0);
}

function install() {
	if (installed) {
		return;
	}
	installed = true;
	buildClassMap();

	ourCallback = fp => {
		dispatchCount++;
		try {
			dispatch(fp);
		} catch (e) {
			console.error('[observePacket] dispatch error:', e);
		}
		if (externalReadCb) {
			const cb = externalReadCb;
			externalReadCb = null;
			try {
				cb(fp);
			} catch (e) {
				console.error('[observePacket] external read cb error:', e);
			}
		}
	};

	try {
		Object.defineProperty(Network.read, 'callback', {
			get() {
				return ourCallback;
			},
			set(v) {
				// null = NetworkManager clearing after call → ignore.
				// Any other fn = external one-shot callback to queue.
				if (v && v !== ourCallback) {
					externalReadCb = v;
				}
			},
			configurable: true
		});
	} catch (e) {
		console.error('[observePacket] defineProperty failed:', e);
	}
}

/**
 * Register an additive listener for a packet. The callback is invoked
 * with the decoded struct each time the packet is received.
 *
 * @param {Function} packetClass — constructor from PACKET.AC/HC/ZC/CZ.X (must have .id)
 * @param {Function} callback — (pkt) => decoded instance
 * @returns {boolean} true if registered, false if args invalid
 */
export function observePacket(packetClass, callback) {
	const rawId = packetClass && packetClass.id;
	if (!rawId || typeof callback !== 'function') {
		return false;
	}
	// Normalise: .id is a decimal string ("1080") from
	// Object.keys(PacketRegister); fp.readUShort() returns a Number —
	// strict-equality Map.get misses if we store the string.
	const id = typeof rawId === 'string' ? Number(rawId) : rawId;
	if (!Number.isFinite(id) || id === 0) {
		return false;
	}
	if (!listeners.has(id)) {
		listeners.set(id, []);
	}
	listeners.get(id).push(callback);
	install();
	return true;
}

function notifyAny(id, name, instance) {
	for (let i = 0, n = anyListeners.length; i < n; ++i) {
		try {
			anyListeners[i](id, name, instance);
		} catch (e) {
			console.error('[observeAny] cb:', e);
		}
	}
}

/**
 * Catch-all tap: cb(id, packetName, instance|null) for EVERY inbound packet
 * (unknown opcodes report a null instance). For debug logging. Returns an
 * unsubscribe function.
 *
 * @param {function(number, ?string, ?object): void} cb
 * @returns {function(): void}
 */
export function observeAny(cb) {
	if (typeof cb !== 'function') {
		return () => {};
	}
	anyListeners.push(cb);
	install();
	return () => {
		const i = anyListeners.indexOf(cb);
		if (i >= 0) {
			anyListeners.splice(i, 1);
		}
	};
}

/**
 * Diagnostic helper — returns current observer state.
 */
export function observePacketStatus() {
	return {
		installed,
		dispatchCount,
		listenerCount: listeners.size,
		classMapSize: classMap ? Object.keys(classMap).length : 0,
		readCallbackBound: Network.read.callback === ourCallback,
		externalQueued: !!externalReadCb
	};
}
