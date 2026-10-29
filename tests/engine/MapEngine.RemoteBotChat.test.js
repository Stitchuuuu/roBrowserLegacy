/**
 * tests/engine/MapEngine.RemoteBotChat.test.js
 *
 * On a remote bot, the bot's console commands become slash commands of the chat (each sends `@@<line>`, which
 * the bot runs), without taking a name the client already answers to, and go when the bot's peer does. /log
 * asks the bot for its log and shows it under the Bot log filter, in this tab when no tab shows it.
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
	settings: { tabOption: [[0, 1], [2]] }
}));

vi.mock('Network/RemoteBot.js', () => ({
	default: {
		onText: fn => (mocks.onText = fn),
		sendText: message => mocks.reachable && mocks.sent.push(message) > 0
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

const RemoteBotChatEngine = (await import('Engine/MapEngine/RemoteBotChat.js')).default;
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
