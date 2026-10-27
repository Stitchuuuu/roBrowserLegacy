/**
 * tests/engine/CharEngine.repick.test.js
 *
 * After a map server it could not reach, auto-retry reloads char select and
 * picks the same character again as soon as the list holds it. Straight from
 * an auto-retry login, it picks an account's only character. Attached to a
 * remote bot from its list, it picks the character the bot plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The packet handlers are module-private and only reachable through the hooks
// init() registers, so the Network mock keeps the packet name -> handler map.
const mocks = vi.hoisted(() => {
	const structs = {};
	return {
		hooks: {},
		sent: [],
		structs,
		charSelect: {
			append: vi.fn(),
			remove: vi.fn(),
			setInfo: vi.fn(),
			addCharacter: vi.fn()
		},
		winLoading: { append: vi.fn(), remove: vi.fn() },
		botCharacter: null
	};
});

/** A packet structure per name, constructible and named for the hook map. */
function struct(name) {
	if (!mocks.structs[name]) {
		mocks.structs[name] = function Packet() {
			this.name = name;
		};
		mocks.structs[name].packetName = name;
	}
	return mocks.structs[name];
}

vi.mock('Network/PacketStructure.js', () => ({
	default: new Proxy({}, { get: (_t, group) => new Proxy({}, { get: (_g, name) => struct(group + '.' + name) }) })
}));
vi.mock('Network/NetworkManager.js', () => ({
	default: {
		connect: vi.fn(),
		hookPacket: (s, fn) => {
			mocks.hooks[s.packetName] = fn;
		},
		sendPacket: pkt => mocks.sent.push(pkt),
		setPing: vi.fn(),
		read: vi.fn(),
		close: vi.fn(),
		utils: { longToIP: () => '127.0.0.1' }
	}
}));
vi.mock('Network/RemoteBot.js', () => ({ default: { character: () => mocks.botCharacter } }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20211103 } }));
vi.mock('DB/DBManager.js', () => ({ default: { getMessage: id => 'MSG ' + id } }));
vi.mock('Core/Configs.js', () => ({ default: { get: (_k, d) => d, getServer: () => ({}) } }));
vi.mock('Core/Events.js', () => ({ default: {} }));
vi.mock('Audio/SoundManager.js', () => ({ default: { play: vi.fn() } }));
vi.mock('Audio/BGM.js', () => ({ default: { play: vi.fn() } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({
	default: {
		removeComponents: vi.fn(),
		getComponent: name => (name === 'WinLoading' ? mocks.winLoading : null)
	}
}));
vi.mock('UI/Background.js', () => ({ default: { setLoginBackground: cb => cb() } }));
vi.mock('UI/Components/PincodeWindow/PincodeWindow.js', () => ({ default: {} }));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/JoystickUI/JoystickUI.js', () => ({ default: { onRestore: vi.fn() } }));
vi.mock('UI/Components/CharSelect/CharSelect.js', () => ({
	default: Object.assign(mocks.charSelect, { selectUIVersion: vi.fn() })
}));
vi.mock('UI/Components/CharCreate/CharCreate.js', () => ({ default: { selectUIVersion: vi.fn() } }));
vi.mock('Renderer/Entity/Player.js', () => ({
	default: function Player(entity) {
		this.CharNum = entity.CharNum;
	}
}));

const CharEngine = (await import('Engine/CharEngine.js')).default;
const AutoRetry = (await import('Engine/AutoRetry.js')).default;

const SERVER = { ip: 0, port: 6121 };

/** Deliver a char-server packet to the handler init() hooked for it. */
function deliver(name, pkt) {
	mocks.hooks['HC.' + name](pkt);
}

/** Character slots the client asked to play, in order. */
function picked() {
	return mocks.sent.filter(pkt => pkt.name === 'CH.SELECT_CHAR').map(pkt => pkt.CharNum);
}

/** Log in to char select, pick slot 2, as the player would. */
function pickSlot2() {
	CharEngine.init(SERVER);
	deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 0 }, { CharNum: 2 }] });
	mocks.charSelect.onConnectRequest({ CharNum: 2 });
	mocks.sent.length = 0;
}

describe('CharEngine re-pick after a failed map connect', () => {
	beforeEach(() => {
		AutoRetry.setEnabled(true);
		mocks.sent.length = 0;
	});

	afterEach(() => {
		AutoRetry.setEnabled(false);
	});

	it('picks the same slot again once the reloaded list holds it', () => {
		pickSlot2();
		expect(AutoRetry.attempt()).toBe(1);

		CharEngine.reload(null, true);
		// The header carries no list: nothing to pick from yet, still counting
		deliver('ACCEPT_ENTER_NEO_UNION_HEADER', {});
		expect(picked()).toEqual([]);
		expect(AutoRetry.attempt()).toBe(1);

		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 0 }, { CharNum: 2 }] });
		expect(picked()).toEqual([2]);
		expect(AutoRetry.attempt()).toBe(2);
	});

	it('picks it from a later page of the list', () => {
		pickSlot2();
		CharEngine.reload(null, true);
		deliver('ACCEPT_ENTER_NEO_UNION_HEADER', {});

		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 0 }, { CharNum: 1 }, { CharNum: 3 }] });
		expect(picked()).toEqual([]);

		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 2 }] });
		expect(picked()).toEqual([2]);
	});

	it('leaves the pick to the player when the slot is gone', () => {
		pickSlot2();
		CharEngine.reload(null, true);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 0 }] });

		expect(picked()).toEqual([]);
		expect(AutoRetry.armed()).toBe(false);

		// Consumed: a later list with the slot back does not pick it either
		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 2 }] });
		expect(picked()).toEqual([]);
	});

	it('does not pick on a plain reload', () => {
		pickSlot2();
		CharEngine.reload(null);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 2 }] });

		expect(picked()).toEqual([]);
		expect(AutoRetry.armed()).toBe(false);
	});
});

describe('CharEngine pick of the only character', () => {
	beforeEach(() => {
		AutoRetry.setEnabled(true);
		AutoRetry.disarm();
		mocks.sent.length = 0;
	});

	afterEach(() => {
		AutoRetry.setEnabled(false);
	});

	/** Reach char select from a login, as LoginEngine does with the box ticked. */
	function login() {
		AutoRetry.arm('user', 'pass');
		CharEngine.init(SERVER);
	}

	it('picks it from a login with auto-retry on', () => {
		login();
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 4 }] });

		expect(picked()).toEqual([4]);
		// Counting again for the map server
		expect(AutoRetry.attempt()).toBe(1);
	});

	it('waits for the last page of a paged list', () => {
		login();
		deliver('ACCEPT_ENTER_NEO_UNION_HEADER', {});
		expect(picked()).toEqual([]);

		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 1 }] });
		expect(picked()).toEqual([1]);
	});

	it('leaves the choice to the player with more than one character', () => {
		login();
		deliver('ACCEPT_ENTER_NEO_UNION_HEADER', {});
		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 0 }, { CharNum: 1 }, { CharNum: 2 }] });
		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [] });

		expect(picked()).toEqual([]);
	});

	it('does not pick without auto-retry', () => {
		AutoRetry.setEnabled(false);
		CharEngine.init(SERVER);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 4 }] });

		expect(picked()).toEqual([]);
	});

	it('does not pick when coming back from the game', () => {
		CharEngine.reload(null);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 4 }] });

		expect(picked()).toEqual([]);
	});
});

describe('CharEngine pick of a remote bot\'s character', () => {
	beforeEach(() => {
		AutoRetry.disarm();
		mocks.sent.length = 0;
	});

	afterEach(() => {
		mocks.botCharacter = null;
	});

	it('picks the character the bot plays, by name', () => {
		mocks.botCharacter = 'Second';
		CharEngine.init(SERVER);
		deliver('ACCEPT_ENTER_NEO_UNION', {
			charInfo: [
				{ CharNum: 0, name: 'First' },
				{ CharNum: 3, name: 'Second' }
			]
		});

		expect(picked()).toEqual([3]);
	});

	it('picks it from a later page of the list', () => {
		mocks.botCharacter = 'Second';
		CharEngine.init(SERVER);
		deliver('ACCEPT_ENTER_NEO_UNION_HEADER', {});
		deliver('ACCEPT_ENTER_NEO_UNION_LIST', {
			charInfo: [
				{ CharNum: 0, name: 'First' },
				{ CharNum: 1, name: 'Third' },
				{ CharNum: 2, name: 'Fourth' }
			]
		});
		expect(picked()).toEqual([]);

		deliver('ACCEPT_ENTER_NEO_UNION_LIST', { charInfo: [{ CharNum: 5, name: 'Second' }] });
		expect(picked()).toEqual([5]);
	});

	it('leaves the pick to the player when the bot plays none of them', () => {
		mocks.botCharacter = 'Gone';
		CharEngine.init(SERVER);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 0, name: 'First' }] });

		expect(picked()).toEqual([]);
	});

	it('picks nothing outside the remote mode', () => {
		CharEngine.init(SERVER);
		deliver('ACCEPT_ENTER_NEO_UNION', { charInfo: [{ CharNum: 0, name: 'First' }] });

		expect(picked()).toEqual([]);
	});
});
