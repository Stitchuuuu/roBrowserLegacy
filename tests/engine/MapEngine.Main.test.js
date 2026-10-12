import { beforeEach, describe, expect, it, vi } from 'vitest';

// The packet handlers in Engine/MapEngine/Main.js are module-private and are
// only reachable through the hooks MainEngine() registers.
const mocks = vi.hoisted(() => ({
	hooks: new Map(),
	chat: vi.fn()
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: vi.fn()
	}
}));

vi.mock('DB/DBManager.js', async () => {
	const JobId = (await import('DB/Jobs/JobConst.js')).default;
	const ASSASSINS = [
		JobId.ASSASSIN,
		JobId.ASSASSIN_H,
		JobId.ASSASSIN_B,
		JobId.GUILLOTINE_CROSS,
		JobId.GUILLOTINE_CROSS_H,
		JobId.GUILLOTINE_CROSS_B,
		JobId.SHADOW_CROSS
	];
	return {
		default: {
			getMessage: id => 'MSG' + id + ' %d',
			isAssassin: job => ASSASSINS.includes(job)
		}
	};
});

vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: {
		addText: (...args) => mocks.chat(...args),
		TYPE: { ERROR: 1, BLUE: 2, INFO: 4, PUBLIC: 8 },
		FILTER: { PUBLIC_LOG: 0, ITEM: 5 }
	}
}));

// UI and renderer modules the engine imports but these handlers never reach.
vi.mock('Renderer/EntityManager.js', () => ({ default: {} }));
vi.mock('Renderer/EffectManager.js', () => ({ default: {} }));
vi.mock('Renderer/Renderer.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/Damage.js', () => ({ default: {} }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatRoom/ChatRoom.js', () => ({ default: {} }));
vi.mock('UI/Components/Announce/Announce.js', () => ({ default: {} }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: {} }));
vi.mock('UI/Components/ChangeCart/ChangeCart.js', () => ({ default: {} }));
vi.mock('UI/Components/PartyFriends/PartyFriends.js', () => ({ default: {} }));
vi.mock('UI/Components/BasicInfo/BasicInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/SkillList/SkillList.js', () => ({ default: {} }));
vi.mock('UI/Components/WinStats/WinStats.js', () => ({ default: {} }));

const MainEngine = (await import('Engine/MapEngine/Main.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;
const Session = (await import('Engine/SessionStorage.js')).default;
const JobId = (await import('DB/Jobs/JobConst.js')).default;

/** Invoke the handler MainEngine() hooked for a given packet structure. */
function deliver(struct, fields) {
	const handler = mocks.hooks.get(struct);
	if (!handler) {
		throw new Error('no handler hooked for that packet');
	}
	const pkt = Object.create(struct.prototype);
	Object.assign(pkt, fields);
	handler(pkt);
	return pkt;
}

beforeEach(() => {
	mocks.hooks.clear();
	mocks.chat.mockClear();
	Session.Entity = { _job: JobId.NOVICE };
	MainEngine();
});

describe('message with a value', () => {
	it('fills the number into the message the packet names', () => {
		deliver(PACKET.ZC.MSG_VALUE, { msg: 1862, value: 7 });
		expect(mocks.chat).toHaveBeenCalledWith('MSG1862 7', 8, 0, '#FFFF00');
	});
});
