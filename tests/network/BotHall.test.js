/**
 * tests/network/BotHall.test.js
 *
 * The hall, over a fake joinRoom: nothing is joined before the player asks, every member is called and asked who
 * it is, the list is what the bots answered, a member that goes leaves the list, an open resolves with the room its
 * bot answered (or a refusal, or no answer), and the settings are kept until forgotten.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ joinRoom: vi.fn(), rooms: [] }));

vi.mock('Vendors/signal/index.js', async importOriginal => ({
	...(await importOriginal()),
	joinRoom: mocks.joinRoom
}));

const SETTINGS = { relay: 'wss://relay.game.invalid/', relayKey: 'k1', room: 'hall-1', secret: 's'.repeat(43) };
const HELLO = {
	t: 'hello',
	v: 1,
	kind: 'node',
	account: 'node_spectate',
	chars: [{ name: 'NodeSpectate', job: 7, lv: 40 }],
	playing: { name: 'NodeSpectate', job: 7, lv: 40, map: 'pay_fild02' },
	windows: 0
};

let BotHall;

function emitter(obj) {
	const handlers = Object.create(null);
	obj.on = (name, fn) => {
		(handlers[name] = handlers[name] || []).push(fn);
		return () => {
			// unused
		};
	};
	obj.emit = (name, ...args) => (handlers[name] || []).forEach(fn => fn(...args));
	return obj;
}

function fakePeer(id) {
	const peer = emitter({ id, via: 'direct', sent: [], close: vi.fn() });
	peer.send = vi.fn(text => {
		peer.sent.push(JSON.parse(text));
		return Promise.resolve();
	});
	peer.say = m => peer.emit('message', JSON.stringify(m));
	return peer;
}

function fakeRoom(params) {
	let resolve;
	let reject;
	const room = emitter({ params, members: [], called: [], leave: vi.fn() });
	room.ready = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	room.ready.catch(() => {
		// reported by close
	});
	room.enter = () => resolve();
	room.fail = code => {
		const err = Object.assign(new Error(code), { code });
		reject(err);
		room.emit('close', err);
	};
	room.connect = vi.fn(id => {
		room.called.push(id);
		return new Promise(() => {
			// the test links by hand
		});
	});
	room.setMembers = ids => {
		room.members = ids;
		room.emit('members', ids);
	};
	room.link = peer => room.emit('peer', peer);
	return room;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function load() {
	vi.resetModules();
	BotHall = (await import('Network/BotHall.js')).default;
}

async function joined() {
	BotHall.join(SETTINGS);
	const room = mocks.rooms[mocks.rooms.length - 1];
	room.enter();
	await tick();
	return room;
}

describe('bot hall', () => {
	beforeEach(async () => {
		localStorage.clear();
		mocks.rooms.length = 0;
		mocks.joinRoom.mockReset();
		mocks.joinRoom.mockImplementation(params => {
			const room = fakeRoom(params);
			mocks.rooms.push(room);
			return room;
		});
		await load();
	});

	it('joins nothing until the player asks', async () => {
		BotHall.saveSettings(SETTINGS);
		await load();

		expect(mocks.joinRoom).not.toHaveBeenCalled();
		expect(BotHall.state()).toBe('off');
	});

	it('joins the hall calling nobody, with room for the account', async () => {
		const room = await joined();

		expect(room.params).toEqual({ ...SETTINGS, max: 40, connect: 'manual' });
		expect(BotHall.state()).toBe('in');
	});

	it('calls every member and asks who it is', async () => {
		const room = await joined();
		room.setMembers(['b1', 'b2']);
		const b1 = fakePeer('b1');
		room.link(b1);

		expect(room.called).toEqual(['b1', 'b2']);
		expect(b1.sent).toEqual([{ t: 'who', v: 1 }]);
	});

	it('lists what the bots answered, a member that says nothing is not listed', async () => {
		const room = await joined();
		room.setMembers(['b1', 'b2']);
		const b1 = fakePeer('b1');
		room.link(b1);
		room.link(fakePeer('b2'));
		b1.say(HELLO);

		const bots = BotHall.bots();
		expect(bots.length).toBe(1);
		expect(bots[0]).toMatchObject({ id: 'b1', via: 'direct', account: 'node_spectate', playing: HELLO.playing });
	});

	it('a hello again updates the row', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		b1.say({ ...HELLO, playing: { ...HELLO.playing, map: 'prontera' }, windows: 1 });

		expect(BotHall.bots()[0].playing.map).toBe('prontera');
		expect(BotHall.bots()[0].windows).toBe(1);
	});

	it('counts the members that have not said who they are yet', async () => {
		const room = await joined();
		room.setMembers(['b1', 'b2']);
		const b1 = fakePeer('b1');
		room.link(b1);
		expect(BotHall.waiting()).toBe(2);

		b1.say(HELLO);
		expect(BotHall.waiting()).toBe(1);
	});

	it('a member that leaves the room leaves the list', async () => {
		const room = await joined();
		const change = vi.fn();
		BotHall.onChange(change);
		room.setMembers(['b1']);
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		room.setMembers([]);

		expect(BotHall.bots()).toEqual([]);
		expect(change).toHaveBeenCalled();
	});

	it('a cut link leaves the list and is called again while the bot is a member', async () => {
		const room = await joined();
		room.setMembers(['b1']);
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		room.emit('leave', b1, 'closed');

		expect(BotHall.bots()).toEqual([]);
		expect(room.called).toEqual(['b1', 'b1']);
	});

	it('a malformed message cuts that member only', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		const b2 = fakePeer('b2');
		room.link(b1);
		room.link(b2);
		b1.say(HELLO);
		b2.say({ ...HELLO, account: 'other' });
		b1.emit('message', '{"t":"hello","v":1}');

		expect(b1.close).toHaveBeenCalled();
		expect(b2.close).not.toHaveBeenCalled();
		expect(BotHall.bots().map(b => b.account)).toEqual(['other']);
	});

	it('open → the room its bot answered', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		const opened = BotHall.open('b1');
		const ask = b1.sent[1];
		b1.say({ t: 'room', v: 1, id: ask.id, room: 'fresh', secret: 'x'.repeat(43) });

		expect(ask).toEqual({ t: 'open', v: 1, id: ask.id });
		await expect(opened).resolves.toEqual({ room: 'fresh', secret: 'x'.repeat(43) });
	});

	it('an answer from another member does not settle the open', async () => {
		vi.useFakeTimers();
		try {
			const room = await (async () => {
				BotHall.join(SETTINGS);
				const r = mocks.rooms[0];
				r.enter();
				await vi.advanceTimersByTimeAsync(0);
				return r;
			})();
			const b1 = fakePeer('b1');
			const b2 = fakePeer('b2');
			room.link(b1);
			room.link(b2);
			b1.say(HELLO);
			const opened = BotHall.open('b1');
			opened.catch(() => {
				// checked below
			});
			b2.say({ t: 'room', v: 1, id: b1.sent[1].id, room: 'theirs', secret: 'y' });
			await vi.advanceTimersByTimeAsync(15000);

			await expect(opened).rejects.toMatchObject({ code: 'no-answer' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('a refusal rejects with its reason', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		const opened = BotHall.open('b1');
		b1.say({ t: 'no', v: 1, id: b1.sent[1].id, why: 'busy' });

		await expect(opened).rejects.toMatchObject({ code: 'busy' });
	});

	it('no answer in 15 s rejects', async () => {
		vi.useFakeTimers();
		try {
			BotHall.join(SETTINGS);
			const room = mocks.rooms[0];
			room.enter();
			const b1 = fakePeer('b1');
			room.link(b1);
			b1.say(HELLO);
			const opened = BotHall.open('b1');
			opened.catch(() => {
				// checked below
			});
			await vi.advanceTimersByTimeAsync(14999);
			let done = false;
			opened.then(
				() => (done = true),
				() => (done = true)
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(done).toBe(false);
			await vi.advanceTimersByTimeAsync(1);

			await expect(opened).rejects.toMatchObject({ code: 'no-answer' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('a bot that leaves while asked rejects its open at once', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		const opened = BotHall.open('b1');
		room.emit('leave', b1, 'closed');

		await expect(opened).rejects.toMatchObject({ code: 'gone' });
	});

	it('a hall closed while a bot is asked rejects its open at once', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		const opened = BotHall.open('b1');
		room.emit('close', Object.assign(new Error('relay'), { code: 'relay' }));

		await expect(opened).rejects.toMatchObject({ code: 'gone' });
	});

	it('an open on a bot not listed rejects at once', async () => {
		await joined();

		await expect(BotHall.open('nobody')).rejects.toMatchObject({ code: 'gone' });
	});

	it('a hall closed by the relay says why and empties the list', async () => {
		BotHall.join(SETTINGS);
		const room = mocks.rooms[0];
		room.fail('key');
		await tick();

		expect(BotHall.state()).toBe('key');
		expect(BotHall.bots()).toEqual([]);
	});

	it('leave leaves the room and rejects what was asked', async () => {
		const room = await joined();
		const b1 = fakePeer('b1');
		room.link(b1);
		b1.say(HELLO);
		const opened = BotHall.open('b1');
		BotHall.leave();

		expect(room.leave).toHaveBeenCalled();
		expect(BotHall.state()).toBe('off');
		await expect(opened).rejects.toMatchObject({ code: 'gone' });
	});

	it('a late event of a left hall changes nothing', async () => {
		const old = await joined();
		await joined();
		const b1 = fakePeer('b1');
		old.link(b1);
		old.setMembers(['b1']);

		expect(b1.sent).toEqual([]);
		expect(old.called).toEqual([]);
	});

	it('keeps the settings until forgotten', async () => {
		BotHall.saveSettings(SETTINGS);
		await load();
		expect(BotHall.loadSettings()).toEqual(SETTINGS);

		BotHall.forgetSettings();
		expect(BotHall.loadSettings()).toBe(null);
		expect(localStorage.getItem('botHall')).toBe(null);
	});

	it('?relay= keeps the relay and its key, then leaves the address bar', async () => {
		history.replaceState(null, '', '/api.html?app=ONLINE&relay=wss%3A%2F%2Fsignal.example%2F&key=k1#remote');
		await load();

		expect(BotHall.loadRelay()).toEqual({ relay: 'wss://signal.example/', relayKey: 'k1' });
		expect(window.location.search).toBe('?app=ONLINE');
		expect(window.location.hash).toBe('#remote');
		history.replaceState(null, '', '/');
	});

	it('a ?relay= that is no wss address keeps nothing', async () => {
		history.replaceState(null, '', '/?relay=nope');
		await load();

		expect(BotHall.loadRelay()).toBe(null);
		expect(window.location.search).toBe('');
	});

	it('no relay until a page link gives one; Forget drops it with the settings', () => {
		expect(BotHall.loadRelay()).toBe(null);
		BotHall.rememberRelay('wss://signal.example/');
		expect(BotHall.loadRelay()).toEqual({ relay: 'wss://signal.example/', relayKey: '' });

		BotHall.forgetSettings();
		expect(BotHall.loadRelay()).toBe(null);
	});

	it('reads no settings from a broken entry', () => {
		localStorage.setItem('botHall', '{"relay":1}');
		expect(BotHall.loadSettings()).toBe(null);
		localStorage.setItem('botHall', 'nope');
		expect(BotHall.loadSettings()).toBe(null);
	});
});
