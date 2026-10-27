import { beforeEach, describe, expect, it, vi } from 'vitest';

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
		winLogin: { append: record('WinLogin.append') },
		skillTarget: { remove: vi.fn() },
		remoteBot: { isActive: vi.fn(() => false), setLoginScreen: vi.fn(), leave: vi.fn(), failure: vi.fn() },
		charEngine: { init: vi.fn() },
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
vi.mock('UI/Components/RemoteCharacters/RemoteCharacters.js', () => ({ default: { append: vi.fn(), remove: vi.fn() } }));
vi.mock('UI/Components/RemoteSettings/RemoteSettings.js', () => ({ default: { append: vi.fn(), remove: vi.fn() } }));
vi.mock('UI/Components/RemoteEntry/RemoteEntry.js', () => ({ default: { append: vi.fn(), remove: vi.fn() } }));
vi.mock('Network/BotHall.js', () => ({ default: { loadSettings: () => null, leave: vi.fn() } }));
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
			'UIManager.removeComponents',
			'Background.setLoginBackground',
			'WinLogin.append'
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

	it('without hall settings, a room the list opened is left before the login window', () => {
		mocks.remoteBot.leave.mockClear();
		LoginEngine.reload();

		expect(mocks.remoteBot.leave).toHaveBeenCalledOnce();
	});
});
