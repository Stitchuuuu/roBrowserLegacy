/**
 * tests/network/RemoteBot.test.js
 *
 * The remote mode, read from the page link: the game sockets come from the
 * bot's room whatever path asks for them, the window sends in clear, the link
 * leaves the address bar, and the paste box exists on the login screen only.
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

function shortcut() {
	window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', altKey: true, shiftKey: true }));
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
		const ask = vi.fn();
		RemoteBot.setLoginScreen(ask);

		expect(RemoteBot.isActive()).toBe(false);
		expect(ask).not.toHaveBeenCalled();
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
		expect(mocks.joinRoom).toHaveBeenCalledTimes(2);
		expect(mocks.joinRoom.mock.calls[1][0].secret).toBe(SECRET);
	});

	it('opens the paste box on the login screen for #remote alone', async () => {
		await load('#remote');
		const ask = vi.fn();

		expect(RemoteBot.isActive()).toBe(false);
		RemoteBot.setLoginScreen(ask);

		expect(ask).toHaveBeenCalledWith(false);
		RemoteBot.setLoginScreen(ask);
		expect(ask).toHaveBeenCalledOnce();
	});

	it('says a page link is no bot link, and keeps no secret in the address bar', async () => {
		await load(LINK);
		await load('#remote&r=bot-1&s=short&relay=' + RELAY);
		const ask = vi.fn();
		RemoteBot.setLoginScreen(ask);

		expect(ask).toHaveBeenCalledWith(true);
		expect(RemoteBot.isActive()).toBe(false);
		expect(location.hash).toBe('#remote');
	});

	it('opens the paste box with Alt+Shift+R on the login screen, or once it shows', async () => {
		await load('');
		shortcut();
		const ask = vi.fn();

		RemoteBot.setLoginScreen(ask);
		expect(ask).toHaveBeenCalledOnce();

		shortcut();
		expect(ask).toHaveBeenCalledTimes(2);
	});

	it('leaves Alt+Shift+R and the links alone once logged in', async () => {
		await load('');
		const ask = vi.fn();
		RemoteBot.setLoginScreen(ask);
		RemoteBot.setLoginScreen(null);

		shortcut();

		expect(ask).not.toHaveBeenCalled();
		expect(RemoteBot.setLink(LINK)).toBe(false);
		expect(RemoteBot.isActive()).toBe(false);

		// Nor is it kept for the next login screen
		RemoteBot.setLoginScreen(ask);
		expect(ask).not.toHaveBeenCalled();
	});

	it('takes a pasted link and refuses anything else', async () => {
		await load('');

		expect(RemoteBot.setLink('hello')).toBe(false);
		expect(RemoteBot.setLink('#r=bot-1&s=short&relay=' + RELAY)).toBe(false);
		expect(RemoteBot.setLink('#r=bot-1&s=' + SECRET)).toBe(false);
		expect(RemoteBot.isActive()).toBe(false);

		expect(RemoteBot.setLink(' https://x.example/api.html?app=ONLINE' + LINK + ' ')).toBe(true);
		expect(RemoteBot.isActive()).toBe(true);
		expect(RemoteBot.setLink(LINK)).toBe(true);
		expect(mocks.rooms[0].leave).toHaveBeenCalledOnce();
	});

	it('builds the game sockets on the bot peer through connect and through defaultSocketFactory', async () => {
		await load(LINK);
		const peer = fakePeer();
		mocks.rooms[0].emit('peer', peer);

		const fromObserver = Network.defaultSocketFactory('127.0.0.1', 6900);
		fromObserver.onComplete = vi.fn();
		const done = vi.fn();
		Network.connect('127.0.0.1', 6900, done);
		await settle();

		expect(fromObserver.sid).toBe(1);
		expect(fromObserver.onComplete).toHaveBeenCalledWith(true);
		expect(done).toHaveBeenCalledWith(true);
		expect(peer.send).toHaveBeenCalled();
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
		['secret', 'secret in this link is not valid'],
		['relay', 'cannot reach the relay (relay)']
	])('tells the player why on %s, and forgets the link', async (code, text) => {
		await load(LINK);
		const done = vi.fn();
		Network.connect('127.0.0.1', 6900, done);
		await settle();

		mocks.rooms[0].emit('close', { code: code, message: code });

		expect(done).toHaveBeenCalledWith(false);
		expect(RemoteBot.failure()).toEqual({ text: expect.stringContaining(text), permanent: true });
		expect(sessionStorage.getItem('remoteBot')).toBe(null);
	});

	it('keeps the link when no bot answered: it may come back', async () => {
		await load(LINK);
		vi.useFakeTimers();
		const done = vi.fn();
		Network.connect('127.0.0.1', 6900, done);
		vi.advanceTimersByTime(15000);
		vi.useRealTimers();

		expect(done).toHaveBeenCalledWith(false);
		expect(RemoteBot.failure()).toEqual({ text: expect.stringContaining('no bot answered'), permanent: false });
		expect(sessionStorage.getItem('remoteBot')).not.toBe(null);
	});

	it('takes a new link on the login screen after a failure', async () => {
		await load(LINK);
		RemoteBot.setLoginScreen(vi.fn());
		Network.connect('127.0.0.1', 6900, vi.fn());
		await settle();
		mocks.rooms[0].emit('close', { code: 'key', message: 'key' });

		expect(RemoteBot.setLink(LINK)).toBe(true);
		expect(RemoteBot.failure()).toBe(null);
	});

	it('has no failure outside the mode', async () => {
		await load('');

		expect(RemoteBot.failure()).toBe(null);
	});
});
