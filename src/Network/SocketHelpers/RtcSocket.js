/**
 * Network/SocketHelpers/RtcSocket.js
 *
 * Game sockets riding the WebRTC peer of a remote bot's room
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @see docs/reference/network/remote-bot.md
 */

import { OPEN, DATA, CLOSE, Outbox, decode } from './RtcFrames.js';

/**
 * How long a socket waits for the bot's peer
 * @const {number}
 */
const PEER_WAIT_MS = 15000;

/**
 * A socket with the WebSocket helper's shape
 *
 * @param {RtcSockets} owner
 * @param {number} sid
 */
class Socket {
	constructor(owner, sid) {
		this.owner = owner;
		this.sid = sid;
		this.connected = false;
		this.timer = 0;
	}

	send(buffer) {
		if (this.connected) {
			this.owner.out.write(DATA, this.sid, new Uint8Array(buffer));
		}
	}

	close() {
		const waiting = this.owner.waiting;
		const index = waiting.indexOf(this);

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
 *
 * @param {object} room - a joinRoom() room of max 2 (the bot and us)
 */
class RtcSockets {
	constructor(room) {
		this.room = room;
		this.socks = Object.create(null);
		this.waiting = [];
		this.out = null;
		this.next = 1;
		this.via = null;
		this.error = null;
		this.lastFailure = null;

		room.on('error', err => {
			console.warn('[RemoteBot] ' + err.code + ': ' + err.message);
		});
		room.on('close', err => {
			if (err) {
				console.error('[RemoteBot] room closed, ' + err.code + ': ' + err.message);
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
	 * Why the last socket failed, if any
	 *
	 * @return {?string} a library error code, or 'no-bot'
	 */
	failure() {
		return this.error || this.lastFailure || null;
	}

	leave() {
		this.room.leave();
	}

	link(peer) {
		console.log('%c[RemoteBot] bot peer ' + peer.id + ' via ' + peer.via, 'font-weight:bold');
		this.via = peer.via;
		this.lastFailure = null;
		this.out = new Outbox(bytes => peer.send(bytes));

		peer.on('message', data => {
			let records;

			if (typeof data === 'string') {
				return;
			}

			try {
				records = decode(data);
			} catch (err) {
				console.error('[RemoteBot] ' + err.message + ', bot peer cut');
				peer.close();
				return;
			}

			for (let i = 0; i < records.length; ++i) {
				const s = this.socks[records[i].sid];
				if (!s) {
					continue;
				}
				if (records[i].type === DATA) {
					if (s.onMessage) {
						s.onMessage(records[i].bytes.slice().buffer);
					}
				} else if (records[i].type === CLOSE) {
					this.end(records[i].sid);
				}
			}
		});

		peer.on('close', reason => {
			console.warn('[RemoteBot] bot peer left (' + reason + ')');
			this.out.close();
			this.out = null;
			this.via = null;
			for (const sid in this.socks) {
				this.end(sid);
			}
		});

		const waiting = this.waiting.splice(0);
		for (let i = 0; i < waiting.length; ++i) {
			clearTimeout(waiting[i].timer);
			this.open(waiting[i]);
		}
	}

	open(s) {
		this.socks[s.sid] = s;
		s.connected = true;
		this.out.write(OPEN, s.sid);
		s.onComplete(true);
	}

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

	fail(code) {
		this.error = code;
		const waiting = this.waiting.splice(0);
		for (let i = 0; i < waiting.length; ++i) {
			clearTimeout(waiting[i].timer);
			waiting[i].onComplete(false);
		}
	}
}

/**
 * Export
 */
export default RtcSockets;
