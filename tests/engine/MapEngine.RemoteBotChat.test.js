/**
 * tests/engine/MapEngine.RemoteBotChat.test.js
 *
 * On a remote bot, the bot's console commands become slash commands of the chat (each sends `@@<line>`, which
 * the bot runs), without taking a name the client already answers to, and go when the bot's peer does. /log
 * asks the bot for its log and shows it under the Bot log filter, in this tab when no tab shows it. Another remote
 * client of the hall on the map can be taken from its context menu: this window lets go of its bot and takes the
 * other one's control once in game.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	onText: null,
	sent: [],
	reachable: true,
	commands: Object.create(null),
	native: ['sit', 'h', 'ok'],
	talk: [],
	lines: [],
	settings: { tabOption: [[0, 1], [2]] },
	wantControl: false,
	active: true,
	switched: [],
	exits: 0,
	refreshes: 0,
	bots: [],
	open: null,
	hall: { relay: 'wss://relay.game.invalid/', relayKey: 'k1', room: 'hall', secret: 's' },
	session: { Entity: { display: { name: 'NodeSpectate' } } }
}));

vi.mock('Network/RemoteBot.js', () => ({
	default: {
		onText: fn => (mocks.onText = fn),
		sendText: message => mocks.reachable && mocks.sent.push(message) > 0,
		isActive: () => mocks.active,
		takeWantControl: () => {
			const want = mocks.wantControl;
			mocks.wantControl = false;
			return want;
		},
		switchTo: room => mocks.switched.push(room)
	}
}));
vi.mock('Network/BotHall.js', () => ({
	default: {
		playing: (name, map) => mocks.bots.find(b => b.playing.name === name && b.playing.map === map) || null,
		open: id => mocks.open(id),
		loadSettings: () => mocks.hall
	}
}));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: { currentMap: 'prontera.gat' } }));
vi.mock('UI/Components/Escape/Escape.js', () => ({
	default: {
		refreshCharSelect: () => ++mocks.refreshes,
		onExitRequest: () => ++mocks.exits
	}
}));
vi.mock('Controls/ProcessCommand.js', () => ({
	default: {
		add: (name, description, callback) => (mocks.commands[name] = { description, callback }),
		remove: name => delete mocks.commands[name],
		exists: name => name in mocks.commands || mocks.native.includes(name)
	}
}));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: {
		TYPE: { PUBLIC: 2, ERROR: 64, INFO: 128 },
		FILTER: { PUBLIC_LOG: 0, BOT_LOG: 100 },
		activeTab: 1,
		onRequestTalk: (user, text, target) => mocks.talk.push([user, text, target]),
		addText: (text, type, filter) => mocks.lines.push([text, filter])
	}
}));
vi.mock('UI/Components/ChatBoxSettings/ChatBoxSettings.js', () => ({ default: mocks.settings }));

const { default: RemoteBotChatEngine, controllable, takeControl } = await import('Engine/MapEngine/RemoteBotChat.js');
RemoteBotChatEngine();

const LIST = [
	{ name: 'status', aliases: ['st'], help: 'show your status' },
	{ name: 'sit', aliases: [], help: 'sit down' },
	{ name: 'help', aliases: ['h'], help: 'list commands' }
];

beforeEach(() => {
	mocks.onText(null);
	mocks.sent.length = 0;
	mocks.talk.length = 0;
	mocks.lines.length = 0;
	mocks.reachable = true;
	mocks.settings.tabOption = [[0, 1], [2]];
	mocks.switched.length = 0;
	mocks.exits = 0;
	mocks.active = true;
	mocks.bots = [];
});

describe('RemoteBotChat', () => {
	it("adds the bot's commands and aliases, never over the client's own, plus /log", () => {
		mocks.onText({ t: 'cmds', v: 1, list: LIST });

		expect(Object.keys(mocks.commands).sort()).toEqual(['help', 'log', 'st', 'status']);
		expect(mocks.commands.status.description).toBe('show your status');
	});

	it("sends a bot command to the bot as @@ and the line as typed", () => {
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.commands.st.callback('st now');

		expect(mocks.talk).toEqual([['', '@@st now', 2]]);
	});

	it("takes them all out when the bot's peer goes", () => {
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.onText(null);

		expect(Object.keys(mocks.commands)).toEqual([]);
	});

	it('/log asks for the log, shows it under Bot log in this tab, and /log again stops it', () => {
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.onText({ t: 'log', v: 1, lines: ['before /log'] });
		expect(mocks.lines).toEqual([]);

		mocks.commands.log.callback('log');
		expect(mocks.sent).toEqual([{ t: 'log', v: 1, on: true }]);
		expect(mocks.settings.tabOption).toEqual([[0, 1], [2, 100]]);

		mocks.lines.length = 0;
		mocks.onText({ t: 'log', v: 1, lines: ['HP 100/100', 42] });
		expect(mocks.lines).toEqual([['HP 100/100', 100]]);

		mocks.commands.log.callback('log');
		expect(mocks.sent[1]).toEqual({ t: 'log', v: 1, on: false });
		mocks.lines.length = 0;
		mocks.onText({ t: 'log', v: 1, lines: ['after'] });
		expect(mocks.lines).toEqual([]);
	});

	it('leaves the tabs as they are when one already shows the bot log', () => {
		mocks.settings.tabOption = [[0, 100], [2]];
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.commands.log.callback('log');

		expect(mocks.settings.tabOption).toEqual([[0, 100], [2]]);
	});

	it('says so when the bot cannot be reached', () => {
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.reachable = false;
		mocks.commands.log.callback('log');

		expect(mocks.lines).toEqual([['Bot log: the bot cannot be reached.', 0]]);
	});
});

describe('RemoteBotChat: another remote client taken from the map', () => {
	const WOLF = { id: 'b2', playing: { name: 'NodeLvbKWolf', map: 'prontera' } };
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	it("offers 'Control' on a character another bot of the hall plays here only", () => {
		mocks.bots = [WOLF, { id: 'b1', playing: { name: 'NodeSpectate', map: 'prontera' } }];

		expect(controllable('NodeLvbKWolf')).toBe(WOLF);
		expect(controllable('NodeSpectate')).toBe(null); // this window's own bot
		expect(controllable('Stranger')).toBe(null);
		mocks.active = false;
		expect(controllable('NodeLvbKWolf')).toBe(null);
	});

	it("keeps the room the other bot opened, then leaves this one as Exit does", async () => {
		mocks.bots = [WOLF];
		mocks.open = id => Promise.resolve({ room: 'fresh-' + id, secret: 'x' });
		takeControl('NodeLvbKWolf');
		await settle();

		expect(mocks.switched).toEqual([
			{ relay: 'wss://relay.game.invalid/', relayKey: 'k1', room: 'fresh-b2', secret: 'x', character: 'NodeLvbKWolf' }
		]);
		expect(mocks.exits).toBe(1);
	});

	it('stays on this bot and says why when the other one does not open', async () => {
		mocks.bots = [WOLF];
		mocks.open = () => Promise.reject(Object.assign(new Error('busy'), { code: 'busy' }));
		takeControl('NodeLvbKWolf');
		await settle();

		expect(mocks.switched).toEqual([]);
		expect(mocks.exits).toBe(0);
		expect(mocks.lines).toEqual([['Control: this remote client has too many windows open.', 0]]);
	});

	it('one open at a time: a second click while the bot answers opens nothing', async () => {
		mocks.bots = [WOLF];
		let opens = 0;
		let answer;
		mocks.open = () => (++opens, new Promise((resolve, reject) => (answer = reject)));
		takeControl('NodeLvbKWolf');
		takeControl('NodeLvbKWolf');
		answer(Object.assign(new Error('busy'), { code: 'busy' }));
		await settle();

		expect(opens).toBe(1);
	});

	it('an answer that comes once this character left the map switches nothing and says nothing', async () => {
		mocks.bots = [WOLF];
		let answer;
		mocks.open = () => new Promise((resolve, reject) => (answer = { resolve, reject }));
		const before = mocks.session.Entity;
		takeControl('NodeLvbKWolf');
		mocks.session.Entity = null; // back to the character select, or out of the game
		answer.resolve({ room: 'late', secret: 'x' });
		await settle();
		mocks.session.Entity = before;

		expect(mocks.switched).toEqual([]);
		expect(mocks.exits).toBe(0);
	});

	it('says so when the hall settings are gone', () => {
		mocks.bots = [WOLF];
		const kept = mocks.hall;
		mocks.hall = null;
		takeControl('NodeLvbKWolf');
		mocks.hall = kept;

		expect(mocks.lines).toEqual([['Control: this remote client left the hall.', 0]]);
	});

	it('takes the control once in game after a switch, not on the next map', () => {
		mocks.wantControl = true;
		mocks.onText({ t: 'cmds', v: 1, list: LIST });
		mocks.onText({ t: 'cmds', v: 1, list: LIST });

		expect(mocks.talk).toEqual([['', '@control on', 2]]);
	});

	it('shows or hides Character select when the bot says who holds the control, or leaves', () => {
		const before = mocks.refreshes;
		mocks.onText({ t: 'control', v: 1, on: true });
		mocks.onText(null);

		expect(mocks.refreshes - before).toBe(2);
	});
});
