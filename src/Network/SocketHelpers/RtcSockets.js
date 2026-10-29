/**
 * Network/SocketHelpers/RtcSockets.js
 *
 * Game sockets riding the WebRTC peer of a remote bot's room
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

import { OPEN, DATA, CLOSE, Outbox, decode } from './RtcFrames.js';

/**
 * How long a socket waits for the bot's peer
 * @const {number}
 */
const PEER_WAIT_MS = 15000;

/**
 * How long the frames are watched once the bot answered a load-end ack
 * @const {number}
 */
const WATCH_MS = 15000;

/**
 * A socket with the WebSocket helper's shape
 */
class Socket {
	/**
	 * @param {RtcSockets} owner
	 * @param {number} sid - socket id of its records
	 */
	constructor(owner, sid) {
		this.owner = owner;
		this.sid = sid;
		this.connected = false;
		this.closed = false;
		this.timer = 0;
	}

	/**
	 * @param {ArrayBuffer} buffer
	 */
	send(buffer) {
		if (this.connected) {
			const bytes = new Uint8Array(buffer);

			// CZ_NOTIFY_ACTORINIT: the map is loaded, the bot answers with what it kept of it
			if (bytes.length === 2 && bytes[0] === 0x7d && bytes[1] === 0) {
				this.owner.ackAt = performance.now();
			}
			this.owner.out.write(DATA, this.sid, bytes);
		}
	}

	/**
	 * Closing connection to the bot
	 */
	close() {
		const waiting = this.owner.waiting;
		const index = waiting.indexOf(this);

		this.closed = true;
		if (index >= 0) {
			waiting.splice(index, 1);
			clearTimeout(this.timer);
		} else if (this.connected) {
			this.owner.out.write(CLOSE, this.sid);
			this.owner.end(this.sid);
		}
	}
}

/**
 * The sockets of one room: one peer, one record stream
 */
class RtcSockets {
	/**
	 * @param {object} room - a joinRoom() room of max 2 (the bot and us)
	 * @see docs/reference/network/remote-bot.md
	 */
	constructor(room) {
		this.room = room;
		this.socks = Object.create(null);
		this.waiting = [];
		this.out = null;
		this.next = 1;
		this.error = null;
		this.lastFailure = null;
		this.peer = null;
		this.ackAt = 0;

		room.on('error', err => {
			console.warn(`[RemoteBot] ${err.code}: ${err.message}`);
		});
		room.on('close', err => {
			if (err) {
				console.error(`[RemoteBot] room closed, ${err.code}: ${err.message}`);
				this.fail(err.code);
			}
		});
		room.on('peer', peer => this.link(peer));
	}

	/**
	 * Socket factory
	 *
	 * @return {Socket}
	 */
	socket() {
		const s = new Socket(this, this.next++);

		// NetworkManager sets onComplete after the factory returns
		setTimeout(() => {
			if (s.closed) {
				return;
			}
			if (this.error) {
				s.onComplete(false);
			} else if (this.out) {
				this.open(s);
			} else {
				this.waiting.push(s);
				s.timer = setTimeout(() => {
					this.waiting.splice(this.waiting.indexOf(s), 1);
					this.lastFailure = 'no-bot';
					s.onComplete(false);
				}, PEER_WAIT_MS);
			}
		}, 0);

		return s;
	}

	/**
	 * Why the last socket failed
	 *
	 * @return {?string} a library error code, 'no-bot', or null
	 */
	failure() {
		return this.error || this.lastFailure;
	}

	/**
	 * Leave the room, for another link
	 */
	leave() {
		this.room.leave();
	}

	/**
	 * The bot's peer is there: open the waiting sockets on it
	 *
	 * @param {object} peer - a joinRoom() peer
	 */
	link(peer) {
		console.log(`%c[RemoteBot] bot peer ${peer.id} via ${peer.via}`, 'font-weight:bold');
		this.lastFailure = null;
		this.peer = peer;
		this.out = new Outbox(bytes => peer.send(bytes));

		peer.on('message', data => {
			const ackAt = this.ackAt;
			const start = performance.now();
			let records;

			if (typeof data === 'string') {
				return;
			}

			try {
				records = decode(data);
			} catch (err) {
				console.error(`[RemoteBot] ${err.message}, bot peer cut`);
				peer.close();
				return;
			}

			for (let i = 0, count = records.length; i < count; ++i) {
				const record = records[i];
				const s = this.socks[record.sid];

				if (!s) {
					continue;
				}
				if (record.type === DATA) {
					s.onMessage(record.bytes.slice().buffer);
				} else if (record.type === CLOSE) {
					this.end(record.sid);
				}
			}

			if (ackAt) {
				this.ackAt = 0;
				this.watch(peer, start - ackAt, performance.now() - start);
			}
		});

		peer.on('close', reason => {
			console.warn(`[RemoteBot] bot peer left (${reason})`);
			this.out.close();
			this.out = null;
			for (const sid in this.socks) {
				this.end(sid);
			}
		});

		const waiting = this.waiting.splice(0);
		for (let i = 0, count = waiting.length; i < count; ++i) {
			clearTimeout(waiting[i].timer);
			this.open(waiting[i]);
		}
	}

	/**
	 * Timing of an answer to a load-end ack, in the console and in the bot's session log: the wait is
	 * the way there and back, the handling and the longest frame are this window's
	 *
	 * @param {object} peer - the bot's peer
	 * @param {number} wait - ms from the ack to the answer
	 * @param {number} handled - ms to handle the answer's packets
	 * @see docs/reference/network/remote-bot.md
	 */
	watch(peer, wait, handled) {
		const end = performance.now() + WATCH_MS;
		let last = performance.now();
		let longest = 0;

		const frame = now => {
			longest = Math.max(longest, now - last);
			last = now;
			if (now < end && !peer.closed) {
				requestAnimationFrame(frame);
				return;
			}

			const report = {
				t: 'timing',
				v: 1,
				via: peer.via,
				wait: Math.round(wait),
				handled: Math.round(handled),
				longestFrame: Math.round(longest)
			};
			console.log(
				`[RemoteBot] map from the bot: answered in ${report.wait} ms (via ${report.via}), handled in ${report.handled} ms, longest frame ${report.longestFrame} ms over ${WATCH_MS / 1000} s`
			);
			if (!peer.closed) {
				// Text: a bot that does not know it ignores it
				peer.send(JSON.stringify(report)).catch(() => {});
			}
		};
		requestAnimationFrame(frame);
	}

	/**
	 * @param {Socket} s
	 */
	open(s) {
		this.socks[s.sid] = s;
		s.connected = true;
		this.out.write(OPEN, s.sid);
		s.onComplete(true);
	}

	/**
	 * A socket is over, from either side
	 *
	 * @param {number|string} sid
	 */
	end(sid) {
		const s = this.socks[sid];

		if (!s) {
			return;
		}
		delete this.socks[sid];
		s.connected = false;
		if (s.onClose) {
			s.onClose();
		}
	}

	/**
	 * The room ended for good: no socket opens any more
	 *
	 * @param {string} code - library error code
	 */
	fail(code) {
		const waiting = this.waiting.splice(0);

		this.error = code;
		for (let i = 0, count = waiting.length; i < count; ++i) {
			clearTimeout(waiting[i].timer);
			waiting[i].onComplete(false);
		}
	}
}

/**
 * Export
 */
export default RtcSockets;
