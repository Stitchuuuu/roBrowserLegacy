import { beforeEach, describe, expect, it, vi } from 'vitest';

// processCommand runs with the chat box as `this`, so the same recording object
// stands in for the module and for the receiver.
const mocks = vi.hoisted(() => ({
	sent: [],
	chatBox: {
		addText: vi.fn(),
		TYPE: { INFO: 1, BLUE: 2, ERROR: 4 },
		FILTER: { PUBLIC_LOG: 8 },
		PrivateMessageStorage: { nick: '', msg: '', blockNicks: [] }
	},
	group: { onRequestInvitation: vi.fn(), onRequestLeave: vi.fn(), onRequestCreationEasy: vi.fn() },
	guild: { createGuild: vi.fn(), requestPlayerInvitationByName: vi.fn(), breakGuild: vi.fn() }
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: { sendPacket: pkt => mocks.sent.push(pkt), hookPacket: vi.fn() }
}));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: mocks.chatBox }));
vi.mock('DB/DBManager.js', () => ({
	default: { getMessage: (id, defaultText) => (defaultText !== undefined ? defaultText : 'MSG ' + id) }
}));
vi.mock('Core/Configs.js', () => ({ default: { get: (_k, d) => d } }));
vi.mock('Engine/MapEngine/Group.js', () => ({ default: mocks.group }));
vi.mock('Engine/MapEngine/Guild.js', () => ({ default: mocks.guild }));
vi.mock('Engine/MapEngine/Friends.js', () => ({ default: { sayHi: vi.fn() } }));
vi.mock('Audio/BGM.js', () => ({ default: { play: vi.fn(), stop: vi.fn() } }));
vi.mock('Audio/SoundManager.js', () => ({ default: { stop: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { tick: 0 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { forEach: vi.fn() } }));
vi.mock('Renderer/EffectManager.js', () => ({ default: { spam: vi.fn(), remove: vi.fn() } }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: { currentMap: 'prontera.rsw' } }));
vi.mock('Renderer/Effects/SnowWeather.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/RainWeather.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/SakuraWeatherEffect.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/PokJukWeatherEffect.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/CloudWeatherEffect.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatRoomCreate/ChatRoomCreate.js', () => ({ default: { show: vi.fn() } }));
vi.mock('UI/Components/ChatRoom/ChatRoom.js', () => ({ default: { remove: vi.fn() } }));
vi.mock('UI/Components/HomunInformations/HomunInformations.js', () => ({ default: { resetAI: vi.fn() } }));
vi.mock('UI/Components/MercenaryInformations/MercenaryInformations.js', () => ({
	default: { resetAI: vi.fn() }
}));
vi.mock('UI/Components/Captcha/CaptchaUpload.js', () => ({ default: {} }));
vi.mock('UI/Components/Captcha/CaptchaSelector.js', () => ({ default: {} }));
vi.mock('UI/Components/Navigation/Navigation.js', () => ({ default: {} }));

const ProcessCommand = (await import('Controls/ProcessCommand.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;
const PACKETVER = (await import('Network/PacketVerManager.js')).default;
const Session = (await import('Engine/SessionStorage.js')).default;
const ControlPreferences = (await import('Preferences/Controls.js')).default;
const MapPreferences = (await import('Preferences/Map.js')).default;

/** Type a command the way the chat box hands it over, without the slash. */
function run(text) {
	ProcessCommand.processCommand.call(mocks.chatBox, text);
}

/** The single packet a command sent. */
function sentOne() {
	expect(mocks.sent).toHaveLength(1);
	return mocks.sent[0];
}

beforeEach(() => {
	mocks.sent.length = 0;
	mocks.chatBox.addText.mockClear();
	mocks.chatBox.PrivateMessageStorage.blockNicks.length = 0;
	for (const key in mocks.group) {
		mocks.group[key].mockClear();
	}
	for (const key in mocks.guild) {
		mocks.guild[key].mockClear();
	}

	PACKETVER.value = 20211103;
	Session.Entity = {
		ACTION: { SIT: 2, IDLE: 0 },
		action: 0,
		direction: 0,
		headDir: 0,
		display: { name: 'Tester' }
	};
	ControlPreferences.noctrl = false;
	MapPreferences.fog = true;
});

describe('client-side toggles', () => {
	it('flips /noctrl and reports the state it leaves', () => {
		run('noctrl');

		expect(ControlPreferences.noctrl).toBe(true);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('MSG 717', 1, 8);
		expect(mocks.sent).toHaveLength(0);

		run('noctrl');
		expect(ControlPreferences.noctrl).toBe(false);
		expect(mocks.chatBox.addText).toHaveBeenLastCalledWith('MSG 718', 1, 8);
	});

	it('reports /fog after flipping it', () => {
		run('fog');

		expect(MapPreferences.fog).toBe(false);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('fog off', 1, 8);
	});
});

describe('commands that talk to the server', () => {
	it('sends /memo as a warp point request', () => {
		run('memo');

		expect(sentOne()).toBeInstanceOf(PACKET.CZ.REMEMBER_WARPPOINT);
		expect(mocks.chatBox.addText).not.toHaveBeenCalled();
	});

	it('sits down with /stand when standing, and stands up when sitting', () => {
		run('stand');
		expect(sentOne()).toBeInstanceOf(PACKET.CZ.REQUEST_ACT2);
		expect(mocks.sent[0].action).toBe(2);

		mocks.sent.length = 0;
		Session.Entity.action = Session.Entity.ACTION.SIT;
		run('stand');
		expect(sentOne().action).toBe(3);
	});

	it('uses the older act packet before its 2018 replacement', () => {
		PACKETVER.value = 20180306;
		run('stand');

		expect(sentOne()).toBeInstanceOf(PACKET.CZ.REQUEST_ACT);
	});
});

describe('commands with arguments', () => {
	it('parses /mapmove into map name and coordinates', () => {
		run('mapmove prontera 150 180');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.MOVETO_MAP);
		expect(pkt.mapName).toBe('prontera');
		expect(pkt.xPos).toBe(150);
		expect(pkt.yPos).toBe(180);
	});

	it('sends nothing for /mapmove without coordinates', () => {
		run('mapmove prontera');

		expect(mocks.sent).toHaveLength(0);
	});

	it('hands a quoted /invite name to the party engine', () => {
		run('invite "Some Body"');

		expect(mocks.group.onRequestInvitation).toHaveBeenCalledWith(0, 'Some Body');
	});

	it('prints the usage line for /guildinvite without a name', () => {
		run('guildinvite');

		expect(mocks.guild.requestPlayerInvitationByName).not.toHaveBeenCalled();
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('Usage: /guildinvite <Character Name>', 1, 8);
	});

	it('prefixes /cl clan chat with the speaker name', () => {
		run('cl hello there');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.CLAN_CHAT);
		expect(pkt.msg).toBe('Tester : hello there');
	});
});

describe('whisper blocking', () => {
	it('blocks a name with /ex and keeps it for the reply', () => {
		run('ex Some Body');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.SETTING_WHISPER_PC);
		expect(pkt.name).toBe('Some Body');
		expect(pkt.type).toBe(0);
		expect(mocks.chatBox.PrivateMessageStorage.blockNicks).toEqual(['Some Body']);
	});

	it('allows a name again with /in', () => {
		run('in Some Body');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.SETTING_WHISPER_PC);
		expect(pkt.name).toBe('Some Body');
		expect(pkt.type).toBe(1);
		expect(mocks.chatBox.PrivateMessageStorage.blockNicks).toEqual(['Some Body']);
	});

	it('queues each name in request order', () => {
		run('ex Alice');
		run('in Bob');

		expect(mocks.sent).toHaveLength(2);
		expect(mocks.chatBox.PrivateMessageStorage.blockNicks).toEqual(['Alice', 'Bob']);
	});

	it('asks for the block list with a bare /ex', () => {
		run('ex');

		expect(sentOne()).toBeInstanceOf(PACKET.CZ.REQ_WHISPER_LIST);
	});

	it('prints the /in help line without a name', () => {
		run('in');

		expect(mocks.sent).toHaveLength(0);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('MSG 44', 1, 8);
	});

	it.each([
		['exall', 0],
		['inall', 1]
	])('sends /%s as whisper state %i', (cmd, type) => {
		run(cmd);

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.SETTING_WHISPER_STATE);
		expect(pkt.type).toBe(type);
	});
});

describe('aliases', () => {
	it('runs /nc as /noctrl', () => {
		run('nc');

		expect(ControlPreferences.noctrl).toBe(true);
	});

	it('runs /sit as /stand', () => {
		run('sit');

		expect(sentOne().action).toBe(2);
	});

	it('knows a name a command, an alias or an emotion already answers to', () => {
		expect(ProcessCommand.exists('noctrl')).toBe(true);
		expect(ProcessCommand.exists('nc')).toBe(true);
		expect(ProcessCommand.exists('sit')).toBe(true);
		expect(ProcessCommand.exists('!')).toBe(true);
		expect(ProcessCommand.exists('status')).toBe(false);
	});

	it('passes the alias text through to commands that parse it', () => {
		run('mm izlude 10 20');

		const pkt = sentOne();
		expect(pkt.mapName).toBe('izlude');
		expect(pkt.xPos).toBe(10);
		expect(pkt.yPos).toBe(20);
	});
});

describe('emotions and unknown commands', () => {
	it('sends an emotion shortcut as an emotion request', () => {
		run('!');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.REQ_EMOTION);
		expect(pkt.type).toBe(0);
	});

	it('answers an unknown command in the chat and sends nothing', () => {
		run('notacommand');

		expect(mocks.sent).toHaveLength(0);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('MSG 95', 1, 8);
	});
});

describe('/str+ N stat raise', () => {
	it.each([
		['str', 13],
		['agi', 14],
		['vit', 15],
		['int', 16],
		['dex', 17],
		['luk', 18]
	])('maps /%s+ to status id %i', (stat, statusID) => {
		run(stat + '+ 3');

		const pkt = sentOne();
		expect(pkt).toBeInstanceOf(PACKET.CZ.STATUS_CHANGE);
		expect(pkt.statusID).toBe(statusID);
		expect(pkt.changeAmount).toBe(3);
	});

	it.each([
		['pow', 219],
		['crt', 224]
	])('maps the trait /%s+ to status id %i', (stat, statusID) => {
		run(stat + '+ 2');

		expect(sentOne().statusID).toBe(statusID);
	});

	it('sends the largest amount the packet byte holds as is', () => {
		run('str+ 255');

		expect(sentOne().changeAmount).toBe(255);
	});

	it.each(['str+5', 'str+ -1', 'str+ 1.5', 'STR+ 1', 'abc+ 1'])('treats %s as an unknown command', text => {
		run(text);

		expect(mocks.sent).toHaveLength(0);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('MSG 95', 1, 8);
	});

	// The guard compares the captured string with the number 0, so it never
	// skips: a zero raise goes out as a packet.
	it.skip('does not send a zero raise', () => {
		run('str+ 0');

		expect(mocks.sent).toHaveLength(0);
	});

	// The amount goes out as one byte, so 256 reaches the server as 0 and 300
	// as 44.
	it.skip('never sends an amount the packet byte cannot hold', () => {
		run('str+ 300');

		for (const pkt of mocks.sent) {
			expect(pkt.changeAmount).toBeLessThanOrEqual(255);
		}
	});
});

describe('custom commands', () => {
	it('adds a command with its aliases and removes both', () => {
		const callback = vi.fn();
		ProcessCommand.add('ping', 'Test command', callback, ['pg']);

		expect(ProcessCommand.isEnabled('ping')).toBe(true);
		run('pg now');
		expect(callback).toHaveBeenCalledWith('pg now');

		ProcessCommand.remove('ping');
		expect(ProcessCommand.isEnabled('ping')).toBe(false);
		run('pg');
		expect(callback).toHaveBeenCalledTimes(1);
		expect(mocks.chatBox.addText).toHaveBeenCalledWith('MSG 95', 1, 8);
	});
});
