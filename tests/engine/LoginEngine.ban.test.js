import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// onServerClosed is module-private and only reachable through the hook init()
// registers, so the Network mock keeps the packet name -> handler map.
const mocks = vi.hoisted(() => {
	const calls = [];
	const record = name => vi.fn(() => calls.push(name));

	return {
		calls,
		hooks: {},
		box: null,
		renderer: { width: 1200, height: 800, stop: record('Renderer.stop') },
		mapRenderer: { cancelLoad: record('MapRenderer.cancelLoad'), free: record('MapRenderer.free') },
		background: {
			setLoginBackground: record('Background.setLoginBackground'),
			init: vi.fn(),
			resize: vi.fn(),
			setPercent: vi.fn()
		},
		bgm: { play: vi.fn(), setAvailableExtensions: vi.fn() },
		winLogin: { append: record('WinLogin.append'), remove: vi.fn() },
		remoteCharacters: { append: record('RemoteCharacters.append'), remove: vi.fn() },
		skillTarget: { remove: vi.fn() },
		remoteBot: {
			isActive: vi.fn(() => false),
			setLoginScreen: vi.fn(),
			leave: vi.fn(),
			failure: vi.fn(),
			takeSwitch: vi.fn(() => null),
			useRoom: vi.fn(() => true)
		},
		charEngine: { init: vi.fn() },
		remoteEntry: { append: record('RemoteEntry.append'), remove: vi.fn() },
		botHall: { loadSettings: vi.fn(() => null), loadRelay: vi.fn(() => ({ relay: 'wss://r/', relayKey: '' })), leave: vi.fn() },
		winList: { append: vi.fn(), setList: vi.fn() },
		uiManager: {
			removeComponents: record('UIManager.removeComponents'),
			showErrorBox: vi.fn(),
			showMessageBox: vi.fn(),
			addComponent: vi.fn()
		}
	};
});

// Constructible (onConnectionAccepted builds its ping packet) and named for the hook map
const packet = name => Object.defineProperty(function Packet() {}, 'name', { value: name });

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => {
			mocks.hooks[struct.name] = fn;
		},
		close: vi.fn(),
		connect: vi.fn(),
		setPing: vi.fn(),
		sendPacket: vi.fn()
	}
}));
vi.mock('Network/PacketStructure.js', () => ({
	default: new Proxy(
		{},
		{ get: (_t, group) => new Proxy({}, { get: (_g, name) => packet(group + '.' + name) }) }
	)
}));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20180704 } }));
vi.mock('DB/DBManager.js', () => ({ default: { getMessage: id => 'MSG ' + id } }));
vi.mock('Core/Configs.js', () => ({ default: { setServer: vi.fn(), get: (_k, d) => d, set: vi.fn() } }));
vi.mock('Core/Thread.js', () => ({ default: { send: vi.fn() } }));
vi.mock('Utils/CodepageManager.js', () => ({ default: { detectEncodingByLangtype: vi.fn() } }));
vi.mock('Audio/BGM.js', () => ({ default: mocks.bgm }));
vi.mock('Audio/SoundManager.js', () => ({ default: { play: vi.fn() } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: {} }));
vi.mock('Engine/CharEngine.js', () => ({ default: mocks.charEngine }));
vi.mock('Network/RemoteBot.js', () => ({ default: mocks.remoteBot }));
vi.mock('Plugins/PluginManager.js', () => ({ default: { init: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.mapRenderer }));
vi.mock('UI/UIManager.js', () => ({ default: mocks.uiManager }));
vi.mock('UI/Background.js', () => ({ default: mocks.background }));
vi.mock('UI/Components/WinList/WinList.js', () => ({ default: mocks.winList }));
vi.mock('UI/Components/WinPopup/WinPopup.js', () => ({ default: { clone: () => ({ append: vi.fn(), remove: vi.fn() }) } }));
vi.mock('UI/Components/WinLogin/WinLogin.js', () => ({
	default: Object.assign(mocks.winLogin, { selectUIVersion: vi.fn() })
}));
vi.mock('UI/Components/RemoteCharacters/RemoteCharacters.js', () => ({ default: mocks.remoteCharacters }));
vi.mock('UI/Components/RemoteSettings/RemoteSettings.js', () => ({ default: { append: vi.fn(), remove: vi.fn() } }));
vi.mock('UI/Components/RemoteEntry/RemoteEntry.js', () => ({ default: mocks.remoteEntry }));
vi.mock('Network/BotHall.js', () => ({ default: mocks.botHall }));
vi.mock('UI/Components/SkillTargetSelection/SkillTargetSelection.js', () => ({ default: mocks.skillTarget }));
vi.mock('Vendors/spark-md5.min.js', () => ({ default: {} }));
vi.mock('Utils/Rijndael.js', () => ({ default: {} }));

import LoginEngine from 'Engine/LoginEngine.js';

describe('LoginEngine SC.NOTIFY_BAN', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		LoginEngine.init({ address: '127.0.0.1', port: 6900 });
		mocks.calls.length = 0;
		mocks.uiManager.showMessageBox.mockClear();
		mocks.skillTarget.remove.mockClear();
	});

	it('drops a skill waiting for its target before the box opens', () => {
		mocks.hooks['SC.NOTIFY_BAN']({ ErrorCode: 2 });

		expect(mocks.skillTarget.remove).toHaveBeenCalledOnce();
		expect(mocks.skillTarget.remove.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.uiManager.showMessageBox.mock.invocationCallOrder[0]
		);
	});

	it('stops the map behind the login screen once the ban is acknowledged', () => {
		mocks.hooks['SC.NOTIFY_BAN']({ ErrorCode: 15 });

		expect(mocks.uiManager.showMessageBox).toHaveBeenCalledOnce();
		const [text, , onOk] = mocks.uiManager.showMessageBox.mock.calls[0];
		expect(text).toBe('MSG 579');
		expect(mocks.calls).toEqual([]);

		onOk();

		expect(mocks.calls).toEqual([
			'Renderer.stop',
			'MapRenderer.cancelLoad',
			'MapRenderer.free',
			'Background.setLoginBackground',
			'UIManager.removeComponents',
			'WinLogin.append',
			'RemoteEntry.append'
		]);
		expect(mocks.bgm.play).toHaveBeenCalledWith('01.mp3');
	});
});

describe('LoginEngine login accepted', () => {
	const SERVER = { name: 'rAthena', state: 0, usercount: 0, property: 0 };

	beforeEach(() => {
		LoginEngine.init({ address: '127.0.0.1', port: 6900 });
		mocks.charEngine.init.mockClear();
	});

	it('enters the one char server without its list in the remote mode', () => {
		mocks.remoteBot.isActive.mockReturnValue(true);
		mocks.hooks['AC.ACCEPT_LOGIN3']({ ServerList: [SERVER] });
		mocks.remoteBot.isActive.mockReturnValue(false);

		expect(mocks.charEngine.init).toHaveBeenCalledWith(SERVER);
	});

	it('shows the server list otherwise', () => {
		mocks.hooks['AC.ACCEPT_LOGIN3']({ ServerList: [SERVER] });

		expect(mocks.charEngine.init).not.toHaveBeenCalled();
		expect(mocks.winList.append).toHaveBeenCalled();
	});

	it('back on the login screen, the remote mode takes a room or a link again', () => {
		mocks.remoteBot.setLoginScreen.mockClear();
		LoginEngine.reload();

		expect(mocks.remoteBot.setLoginScreen).toHaveBeenCalledWith(expect.any(Function));
	});

	it('no relay ever given: the login window alone, no way to the bots', () => {
		mocks.botHall.loadRelay.mockReturnValueOnce(null);
		mocks.calls.length = 0;
		LoginEngine.reload();

		expect(mocks.calls).toEqual(['UIManager.removeComponents', 'WinLogin.append']);
	});

	it('Cancel on the char server list: back to the login window with the way to the bots', () => {
		mocks.hooks['AC.ACCEPT_LOGIN3']({ ServerList: [SERVER] });
		mocks.calls.length = 0;
		mocks.winList.onExitRequest();

		expect(mocks.calls).toEqual(['UIManager.removeComponents', 'WinLogin.append', 'RemoteEntry.append']);
		expect(mocks.remoteBot.setLoginScreen).toHaveBeenLastCalledWith(expect.any(Function));
	});

	describe('with the bots set up, a quit goes back to the way the player logged in', () => {
		const HALL = { relay: 'wss://r/', relayKey: '', room: 'hall', secret: 's' };

		beforeEach(() => {
			mocks.botHall.loadSettings.mockReturnValue(HALL);
		});
		afterEach(() => {
			mocks.botHall.loadSettings.mockReturnValue(null);
			mocks.remoteBot.isActive.mockReturnValue(false);
		});

		const banned = () => {
			mocks.calls.length = 0;
			mocks.hooks['SC.NOTIFY_BAN']({ ErrorCode: 2 });
			mocks.uiManager.showMessageBox.mock.lastCall[2]();
			return mocks.calls.filter(c => /^(WinLogin|RemoteEntry|RemoteCharacters)\./.test(c));
		};

		it('logged in by hand: the login window and the way to the bots', () => {
			mocks.winLogin.onConnectionRequest('me', 'pw');
			expect(banned()).toEqual(['WinLogin.append', 'RemoteEntry.append']);
		});

		it('logged in through a remote client: the remote characters', () => {
			mocks.winLogin.onConnectionRequest('me', 'pw');
			mocks.remoteBot.isActive.mockReturnValue(true);
			mocks.winLogin.onConnectionRequest('remote', 'remote');
			expect(banned()).toEqual(['RemoteCharacters.append']);
		});
	});

	it('without hall settings, a room the list opened is left before the login window', () => {
		mocks.remoteBot.leave.mockClear();
		LoginEngine.reload();

		expect(mocks.remoteBot.leave).toHaveBeenCalledOnce();
	});

	it('the remote mode is back before the screen shows: a room left from the game is let go there', () => {
		mocks.remoteBot.leave.mockClear();
		mocks.remoteBot.setLoginScreen.mockClear();
		LoginEngine.reload();

		const back = mocks.remoteBot.setLoginScreen.mock.invocationCallOrder[0];
		expect(back).toBeLessThan(mocks.remoteBot.leave.mock.invocationCallOrder[0]);
	});

	it('a switch from the map logs in through the room the other bot opened, without the list', () => {
		const room = { relay: 'wss://r/', relayKey: '', room: 'fresh', secret: 's', character: 'B', control: true };
		mocks.botHall.loadSettings.mockReturnValue({ relay: 'wss://r/', relayKey: '', room: 'hall', secret: 's' });
		mocks.remoteBot.takeSwitch.mockReturnValueOnce(room);
		mocks.remoteBot.useRoom.mockClear();
		mocks.calls.length = 0;
		LoginEngine.reload();
		mocks.botHall.loadSettings.mockReturnValue(null);

		expect(mocks.remoteBot.useRoom).toHaveBeenCalledWith(room);
		expect(mocks.calls).not.toContain('RemoteCharacters.append');
	});

	it('in the remote mode the hall stays joined once logged in: it names the other remote clients on the map', () => {
		mocks.botHall.leave.mockClear();
		mocks.remoteBot.isActive.mockReturnValue(true);
		mocks.hooks['AC.ACCEPT_LOGIN3']({ ServerList: [SERVER] });
		mocks.remoteBot.isActive.mockReturnValue(false);
		expect(mocks.botHall.leave).not.toHaveBeenCalled();

		mocks.hooks['AC.ACCEPT_LOGIN3']({ ServerList: [SERVER] });
		expect(mocks.botHall.leave).toHaveBeenCalledOnce();
	});
});
