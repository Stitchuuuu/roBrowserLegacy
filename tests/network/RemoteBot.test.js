/**
 * tests/network/RemoteBot.test.js
 *
 * The remote mode, read from the page link: the game sockets come from the
 * bot's room whatever path asks for them (NetworkManager.connect, or a
 * plugin's factory built on Network.defaultSocketFactory), the window sends
 * in clear, and the link leaves the address bar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	uiManager: { showErrorBox: vi.fn() },
	packetCrypt: { init: vi.fn(), process: vi.fn(), reset: vi.fn() },
	joinRoom: vi.fn(),
	rooms: []
}));

vi.mock('UI/UIManager.js', () => ({ default: mocks.uiManager }));
vi.mock('Network/PacketCrypt.js', () => ({ default: mocks.packetCrypt }));
vi.mock('Vendors/signal/index.js', async importOriginal => ({
	...(await importOriginal()),
	joinRoom: mocks.joinRoom
}));

const { newSecret } = await vi.importActual('Vendors/signal/index.js');
const SECRET = newSecret();
const RELAY = 'wss://relay.example/';
const LINK = '#remote&r=bot-1&s=' + SECRET + '&key=k1&relay=' + encodeURIComponent(RELAY);

let Network;
let RemoteBot;

function fakeRoom() {
	const handlers = Object.create(null);
	return {
		on(name, fn) {
			(handlers[name] = handlers[name] || []).push(fn);
		},
		emit(name, ...args) {
			(handlers[name] || []).forEach(fn => fn(...args));
		},
		leave: vi.fn()
	};
}

function fakePeer() {
	return Object.assign(fakeRoom(), {
		id: 'bot',
		via: 'relay',
		close: vi.fn(),
		send: vi.fn(() => Promise.resolve())
	});
}

/** Load the engine on a page opened with this hash */
async function load(hash) {
	history.replaceState(null, '', '/api.html?app=ONLINE' + hash);
	vi.resetModules();
	Network = (await import('Network/NetworkManager.js')).default;
	RemoteBot = (await import('Network/RemoteBot.js')).default;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('remote mode', () => {
	beforeEach(() => {
		sessionStorage.clear();
		mocks.rooms.length = 0;
		mocks.joinRoom.mockReset();
		mocks.joinRoom.mockImplementation(() => {
			const room = fakeRoom();
			mocks.rooms.push(room);
			return room;
		});
		mocks.packetCrypt.init.mockClear();
	});

	it('stays off without #remote', async () => {
		await load('');

		expect(RemoteBot.isActive()).toBe(false);
		expect(RemoteBot.isAsking()).toBe(false);
		expect(mocks.joinRoom).not.toHaveBeenCalled();
	});

	it('joins the room of the link, a two-peer room, and takes the link out of the address bar', async () => {
		await load(LINK);

		expect(RemoteBot.isActive()).toBe(true);
		expect(mocks.joinRoom).toHaveBeenCalledWith({
			relay: RELAY,
			room: 'bot-1',
			secret: SECRET,
			relayKey: 'k1',
			max: 2
		});
		expect(location.hash).toBe('#remote');
		expect(location.search).toBe('?app=ONLINE');
		expect(JSON.parse(sessionStorage.getItem('remoteBot')).secret).toBe(SECRET);
	});

	it('attaches again after a reload in the same tab', async () => {
		await load(LINK);
		await load('#remote');

		expect(RemoteBot.isActive()).toBe(true);
		expect(RemoteBot.isAsking()).toBe(false);
		expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
		expect(mocks.joinRoom.mock.calls[1][0].secret).toBe(SECRET);
	});

	it('asks for a link on #remote alone, and on Alt+Shift+R', async () => {
		await load('#remote');
		expect(RemoteBot.isAsking()).toBe(true);
		expect(RemoteBot.isActive()).toBe(false);

		await load('');
		RemoteBot.onAsk = vi.fn();
		window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', altKey: true, shiftKey: true }));

		expect(RemoteBot.onAsk).toHaveBeenCalledOnce();
		expect(RemoteBot.isAsking()).toBe(true);
	});

	it('takes a pasted link, full or only its parameters, and refuses anything else', async () => {
		await load('');

		expect(RemoteBot.setLink('hello')).toBe(false);
		expect(RemoteBot.setLink('#r=bot-1&s=short&relay=' + RELAY)).toBe(false);
		expect(RemoteBot.setLink('#r=bot-1&s=' + SECRET)).toBe(false);
		expect(RemoteBot.isActive()).toBe(false);

		expect(RemoteBot.setLink('r=bot-1&s=' + SECRET + '&relay=' + RELAY)).toBe(true);
		expect(RemoteBot.isActive()).toBe(true);
		expect(RemoteBot.setLink(' https://x.example/api.html?app=ONLINE' + LINK + ' ')).toBe(true);
		expect(mocks.rooms[0].leave).toHaveBeenCalledOnce();
	});

	it('builds the game sockets on the bot peer through connect and through defaultSocketFactory', async () => {
		await load(LINK);
		const peer = fakePeer();
		mocks.rooms[0].emit('peer', peer);

		const fromObserver = Network.defaultSocketFactory('127.0.0.1', 6900);
		fromObserver.onComplete = vi.fn();
		Network.connect('127.0.0.1', 6900, vi.fn());
		await settle();

		expect(fromObserver.sid).toBe(1);
		expect(fromObserver.onComplete).toHaveBeenCalledWith(true);
		expect(peer.send).toHaveBeenCalled();
		expect(RemoteBot.via()).toBe('relay');
		expect(RemoteBot.setLink(LINK)).toBe(false);
	});

	it('leaves the encryption to the bot on a zone socket', async () => {
		await load(LINK);
		mocks.rooms[0].emit('peer', fakePeer());
		const done = vi.fn();

		Network.connect('127.0.0.1', 5121, done, true);
		await settle();

		expect(done).toHaveBeenCalledWith(true);
		expect(mocks.packetCrypt.init).not.toHaveBeenCalled();
	});

	it('still inits the encryption of a zone socket outside the mode', async () => {
		await load('');
		let socket;
		Network.setSocketFactory(() => (socket = { connected: true, send: vi.fn(), close: vi.fn() }));

		Network.connect('127.0.0.1', 5121, vi.fn(), true);
		socket.onComplete(true);

		expect(mocks.packetCrypt.init).toHaveBeenCalledOnce();
	});

	it.each([
		['room-full', 'another window is already attached'],
		['key', 'refused the key'],
		['secret', 'wrong secret'],
		['relay', 'cannot reach the relay (relay)']
	])('tells the player why on %s', async (code, text) => {
		await load(LINK);
		const done = vi.fn();
		Network.connect('127.0.0.1', 6900, done);
		await settle();

		mocks.rooms[0].emit('close', { code: code, message: code });

		expect(done).toHaveBeenCalledWith(false);
		expect(RemoteBot.failText()).toContain(text);
	});

	it('has no failure text outside the mode', async () => {
		await load('');

		expect(RemoteBot.failText()).toBe(null);
	});
});
