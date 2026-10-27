/**
 * Network/SocketHelpers/RtcFrames.js
 *
 * Records of the remote-bot sockets sharing one WebRTC peer
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

/**
 * Record types: [type u8][sid u16][len u32][payload], little endian
 * @const {number}
 * @see docs/reference/network/remote-bot.md
 */
export const OPEN = 1;
export const DATA = 2;
export const CLOSE = 3;

/**
 * Record header size
 * @const {number}
 */
const HEAD = 7;

/**
 * Largest message the peer carries (the library's default)
 * @const {number}
 */
export const MAX_MESSAGE = 1 << 20;

/**
 * Payload of OPEN and CLOSE
 * @const {Uint8Array}
 */
const EMPTY = new Uint8Array(0);

/**
 * Pack records into one message
 *
 * @param {Array<{type: number, sid: number, bytes: ?Uint8Array}>} records
 * @return {Uint8Array}
 */
export function encode(records) {
	let size = 0;
	for (let i = 0, count = records.length; i < count; ++i) {
		size += HEAD + (records[i].bytes || EMPTY).length;
	}

	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	let at = 0;

	for (let i = 0, count = records.length; i < count; ++i) {
		const record = records[i];
		const bytes = record.bytes || EMPTY;
		view.setUint8(at, record.type);
		view.setUint16(at + 1, record.sid, true);
		view.setUint32(at + 3, bytes.length, true);
		out.set(bytes, at + HEAD);
		at += HEAD + bytes.length;
	}

	return out;
}

/**
 * Unpack a message
 *
 * @param {Uint8Array} msg
 * @return {Array<{type: number, sid: number, bytes: Uint8Array}>} payloads are views on msg
 * @throws on a truncated record
 */
export function decode(msg) {
	const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
	const out = [];
	let at = 0;

	while (at < msg.length) {
		if (at + HEAD > msg.length) {
			throw new Error(`RtcFrames: truncated record head at ${at}`);
		}
		const len = view.getUint32(at + 3, true);
		if (at + HEAD + len > msg.length) {
			throw new Error(`RtcFrames: truncated record at ${at} (${len} B)`);
		}
		out.push({
			type: view.getUint8(at),
			sid: view.getUint16(at + 1, true),
			bytes: msg.subarray(at + HEAD, at + HEAD + len)
		});
		at += HEAD + len;
	}

	return out;
}

/**
 * One message in flight; what is written meanwhile rides the next one
 */
export class Outbox {
	/**
	 * @param {function(Uint8Array): Promise} send - the peer's send
	 */
	constructor(send) {
		this.send = send;
		this.queue = [];
		this.busy = false;
		this.closed = false;
	}

	/**
	 * @param {number} type
	 * @param {number} sid
	 * @param {Uint8Array} [bytes] - copied, the caller may reuse its buffer
	 */
	write(type, sid, bytes) {
		if (this.closed) {
			return;
		}

		const room = MAX_MESSAGE - HEAD;
		if (bytes && bytes.length > room) {
			for (let at = 0; at < bytes.length; at += room) {
				this.queue.push({ type: type, sid: sid, bytes: bytes.slice(at, at + room) });
			}
		} else {
			this.queue.push({ type: type, sid: sid, bytes: bytes ? bytes.slice() : EMPTY });
		}

		if (!this.busy) {
			this.busy = true;
			// The writes of this same turn leave in the same message
			Promise.resolve().then(() => this.flush());
		}
	}

	/**
	 * Send what waits, one message at a time
	 */
	flush() {
		if (this.closed || !this.queue.length) {
			this.busy = false;
			return;
		}

		const queue = this.queue;
		let size = 0;
		let n = 0;
		while (n < queue.length) {
			const next = HEAD + queue[n].bytes.length;
			if (n && size + next > MAX_MESSAGE) {
				break;
			}
			size += next;
			++n;
		}

		this.send(encode(queue.splice(0, n))).then(
			() => this.flush(),
			() => this.close()
		);
	}

	/**
	 * The peer is gone: drop what waits, accept nothing more
	 */
	close() {
		this.closed = true;
		this.busy = false;
		this.queue = [];
	}
}
