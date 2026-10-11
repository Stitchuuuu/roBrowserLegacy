/**
 * tests/engine/LoginEngine.loading.test.js
 *
 * The loading popup prints which auto-retry attempt is running, from the
 * second one on, and nothing once the run is over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const calls = [];
	const record = name => vi.fn(() => calls.push(name));

	return {
		calls,
		hooks: {},
		box: null,
		winLoading: {},
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
		uiManager: {
			removeComponents: record('UIManager.removeComponents'),
			showErrorBox: vi.fn(),
			showMessageBox: vi.fn(),
			addComponent: vi.fn()
		}
	};
});

const packet = name => ({ name });

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => {
			mocks.hooks[struct.name] = fn;
		},
		close: vi.fn()
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
vi.mock('Engine/CharEngine.js', () => ({ default: { init: vi.fn() } }));
vi.mock('Plugins/PluginManager.js', () => ({ default: { init: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.mapRenderer }));
vi.mock('UI/UIManager.js', () => ({ default: mocks.uiManager }));
vi.mock('UI/Background.js', () => ({ default: mocks.background }));
vi.mock('UI/Components/WinList/WinList.js', () => ({ default: {} }));
vi.mock('UI/Components/WinPopup/WinPopup.js', () => ({ default: { clone: () => mocks.winLoading } }));
vi.mock('UI/Components/WinLogin/WinLogin.js', () => ({
	default: { selectUIVersion: vi.fn(), getUI: () => mocks.winLogin }
}));
vi.mock('UI/Components/SkillTargetSelection/SkillTargetSelection.js', () => ({ default: mocks.skillTarget }));
vi.mock('Vendors/spark-md5.min.js', () => ({ default: {} }));
vi.mock('Utils/Rijndael.js', () => ({ default: {} }));

import 'Engine/LoginEngine.js';
import AutoRetry from 'Engine/AutoRetry.js';

const text = { textContent: '' };
mocks.winLoading._shadow = { querySelector: () => text };

/** What the popup reads once appended. */
function shown() {
	mocks.winLoading.onAppend();
	return text.textContent;
}

describe('LoginEngine WinLoading', () => {
	afterEach(() => {
		AutoRetry.disarm();
	});

	it('prints the attempt number from the second attempt on', () => {
		AutoRetry.arm('user', 'pass');
		expect(shown()).toBe('MSG 121');

		AutoRetry.arm('user', 'pass');
		expect(shown()).toBe('MSG 121\nAttempt #2');
	});

	it('drops the attempt line once the run is over', () => {
		AutoRetry.arm('user', 'pass');
		AutoRetry.arm('user', 'pass');
		AutoRetry.arm('user', 'pass');
		expect(shown()).toBe('MSG 121\nAttempt #3');

		// The char server took us; the popup comes back for the character pick
		AutoRetry.disarm();
		expect(shown()).toBe('MSG 121');
	});
});
