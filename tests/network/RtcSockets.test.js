/**
 * tests/network/RtcSockets.test.js
 *
 * The game sockets of the remote mode share one peer of the bot's room: each
 * socket is a run of OPEN / DATA / CLOSE records on it, opened once the bot's
 * peer is there, ended when the peer goes.
 */
import { describe, expect, it, vi } from 'vitest';
import RtcSockets from 'Network/SocketHelpers/RtcSockets.js';
import { OPEN, DATA, CLOSE, encode, decode } from 'Network/SocketHelpers/RtcFrames.js';

function emitter() {
	const handlers = Object.create(null);
	return {
		on(name, fn) {
			(handlers[name] = handlers[name] || []).push(fn);
		},
		emit(name, ...args) {
			(handlers[name] || []).forEach(fn => fn(...args));
		}
	};
}

function fakeRoom() {
	return Object.assign(emitter(), { leave: vi.fn() });
}

function fakePeer() {
	const sent = [];
	const peer = Object.assign(emitter(), {
		id: 'bot',
		via: 'direct',
		sent,
		close: vi.fn(),
		send: vi.fn(bytes => {
			sent.push(...decode(bytes));
			return Promise.resolve();
		})
	});
	return peer;
}

/** A socket as NetworkManager.connect wires it: callbacks set after the factory returns */
function connect(sockets) {
	const s = sockets.socket();
	s.onComplete = vi.fn();
	s.onMessage = vi.fn();
	s.onClose = vi.fn();
	return s;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const bytes = (...b) => Uint8Array.from(b);

describe('RtcSockets', () => {
	it('answers onComplete after the factory returned, once the peer is there', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);

		const s = connect(sockets);
		expect(s.onComplete).not.toHaveBeenCalled();
		await settle();

		expect(s.onComplete).toHaveBeenCalledWith(true);
		expect(s.connected).toBe(true);
		expect(peer.sent).toEqual([{ type: OPEN, sid: s.sid, bytes: new Uint8Array(0) }]);
	});

	it('queues sockets opened before the peer, then opens them in order', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const a = connect(sockets);
		const b = connect(sockets);
		await settle();
		expect(a.onComplete).not.toHaveBeenCalled();

		const peer = fakePeer();
		room.emit('peer', peer);
		await settle();

		expect(a.onComplete).toHaveBeenCalledWith(true);
		expect(b.onComplete).toHaveBeenCalledWith(true);
		expect(peer.sent.map(r => [r.type, r.sid])).toEqual([
			[OPEN, a.sid],
			[OPEN, b.sid]
		]);
	});

	it('carries DATA both ways and ends a socket on CLOSE, each socket on its own', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);
		const login = connect(sockets);
		const char = connect(sockets);
		await settle();

		login.send(bytes(0x64, 0x00).buffer);
		await settle();
		expect(peer.sent[2]).toEqual({ type: DATA, sid: login.sid, bytes: bytes(0x64, 0x00) });

		peer.emit(
			'message',
			encode([
				{ type: DATA, sid: char.sid, bytes: bytes(1, 2, 3) },
				{ type: CLOSE, sid: login.sid, bytes: null }
			])
		);

		expect(new Uint8Array(char.onMessage.mock.calls[0][0])).toEqual(bytes(1, 2, 3));
		expect(login.onMessage).not.toHaveBeenCalled();
		expect(login.onClose).toHaveBeenCalledOnce();
		expect(login.connected).toBe(false);
		expect(char.onClose).not.toHaveBeenCalled();
	});

	it('copies what the game sends: it may reuse its buffer before the message leaves', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);
		const s = connect(sockets);
		await settle();

		const buffer = bytes(7, 8).buffer;
		s.send(buffer);
		new Uint8Array(buffer).fill(0);
		await settle();

		expect(peer.sent[1].bytes).toEqual(bytes(7, 8));
	});

	it('sends CLOSE and calls onClose when the game closes a socket', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);
		const s = connect(sockets);
		await settle();

		s.close();
		await settle();

		expect(peer.sent[1]).toEqual({ type: CLOSE, sid: s.sid, bytes: new Uint8Array(0) });
		expect(s.onClose).toHaveBeenCalledOnce();
		s.send(bytes(1).buffer);
		await settle();
		expect(peer.sent).toHaveLength(2);
	});

	it('ends every socket when the peer goes', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);
		const a = connect(sockets);
		const b = connect(sockets);
		await settle();

		peer.emit('close', 'closed');

		expect(a.onClose).toHaveBeenCalledOnce();
		expect(b.onClose).toHaveBeenCalledOnce();
		expect(sockets.out).toBe(null);
	});

	it('cuts a peer that sends a malformed message', () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);

		peer.emit('message', bytes(DATA, 1));

		expect(peer.close).toHaveBeenCalledOnce();
		expect(sockets.out).not.toBe(null);
	});

	it.each(['key', 'secret', 'room-full', 'rate', 'options'])(
		'fails the pending sockets and the next ones on a fatal %s',
		async code => {
			const room = fakeRoom();
			const sockets = new RtcSockets(room);
			const pending = connect(sockets);
			await settle();

			room.emit('close', { code: code, message: code });
			expect(pending.onComplete).toHaveBeenCalledWith(false);

			const next = connect(sockets);
			await settle();
			expect(next.onComplete).toHaveBeenCalledWith(false);
			expect(sockets.failure()).toBe(code);
		}
	);

	it('gives up on a socket when no bot answers', async () => {
		vi.useFakeTimers();
		const sockets = new RtcSockets(fakeRoom());
		const s = connect(sockets);
		vi.advanceTimersByTime(0);

		vi.advanceTimersByTime(14999);
		expect(s.onComplete).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		vi.useRealTimers();

		expect(s.onComplete).toHaveBeenCalledWith(false);
		expect(sockets.failure()).toBe('no-bot');
	});

	it('never opens a socket the game closed before its first tick', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const peer = fakePeer();
		room.emit('peer', peer);

		const s = connect(sockets);
		s.close();
		await settle();

		expect(s.onComplete).not.toHaveBeenCalled();
		expect(peer.sent).toEqual([]);
	});

	it('forgets a waiting socket the game closed', async () => {
		const room = fakeRoom();
		const sockets = new RtcSockets(room);
		const s = connect(sockets);
		await settle();
		s.close();

		const peer = fakePeer();
		room.emit('peer', peer);
		await settle();

		expect(s.onComplete).not.toHaveBeenCalled();
		expect(peer.sent).toEqual([]);
	});
});
