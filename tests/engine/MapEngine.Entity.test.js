import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only Network, DB, ChatBox and EntityManager matter for the handlers under
// test, so every other Entity.js dependency gets an inert stub - same approach
// as tests/engine/MapEngine.Guild.test.js, just a longer dependency list.
const mocks = vi.hoisted(() => ({
	hooks: new Map(),
	chat: vi.fn(),
	messages: {},
	itemNames: {},
	entityGet: () => null
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: vi.fn()
	}
}));

vi.mock('DB/DBManager.js', () => ({
	default: {
		getMessage: (id, defaultText) =>
			id in mocks.messages ? mocks.messages[id] : defaultText !== undefined ? defaultText : 'NO MSG ' + id,
		getItemInfo: () => ({ identifiedDisplayName: 'Unknown Item' }),
		getItemName: (item, options) => mocks.itemNames(item, options)
	}
}));

vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: {
		addText: (...args) => mocks.chat(...args),
		TYPE: { ERROR: 1 << 6, INFO: 1 << 7, BLUE: 1 << 8 },
		FILTER: { PUBLIC_LOG: 0, ITEM: 5, PARTY_ITEM: 8 }
	}
}));

vi.mock('Renderer/EntityManager.js', () => ({
	default: { get: AID => mocks.entityGet(AID) }
}));

// Everything below is imported by Entity.js but untouched by the MVP / party
// pickup handlers under test - stubbed out so the module loads without pulling
// in WebGL, Shadow DOM or Audio.
vi.mock('DB/Skills/SkillConst.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillInfo.js', () => ({ default: {} }));
vi.mock('DB/Status/StatusConst.js', () => ({ default: {} }));
vi.mock('DB/Status/StatusState.js', () => ({ default: {} }));
vi.mock('DB/Emotions.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillEffect.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillAction.js', () => ({ default: {} }));
vi.mock('DB/Effects/EffectConst.js', () => ({ default: {} }));
vi.mock('DB/Pets/PetMessageConst.js', () => ({ default: {} }));
vi.mock('DB/Jobs/JobConst.js', () => ({ default: {} }));
vi.mock('DB/Monsters/AttackEffectTable.js', () => ({ default: {} }));
vi.mock('Audio/SoundManager.js', () => ({ default: {} }));
vi.mock('Core/Events.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine/Guild.js', () => ({ default: {} }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: {} }));
vi.mock('Renderer/Renderer.js', () => ({ default: {} }));
vi.mock('Renderer/Entity/Entity.js', () => ({ default: class {} }));
vi.mock('Renderer/EffectManager.js', () => ({ default: { spam: vi.fn() } }));
vi.mock('Renderer/Effects/Damage.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/MagicTarget.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/LockOnTarget.js', () => ({ default: {} }));
vi.mock('Renderer/Effects/MagicRing.js', () => ({ default: {} }));
vi.mock('UI/Components/BasicInfo/BasicInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatRoom/ChatRoom.js', () => ({ default: {} }));
vi.mock('UI/Components/Escape/Escape.js', () => ({ default: {} }));
vi.mock('UI/Components/HomunInformations/HomunInformations.js', () => ({ default: {} }));
vi.mock('UI/Components/MercenaryInformations/MercenaryInformations.js', () => ({ default: {} }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: {} }));
vi.mock('UI/Components/ShortCut/ShortCut.js', () => ({ default: {} }));
vi.mock('UI/Components/StatusIcons/StatusIcons.js', () => ({ default: {} }));
vi.mock('UI/Components/MiniMap/MiniMap.js', () => ({ default: { removeNpcMark: vi.fn(), addNpcMark: vi.fn() } }));
vi.mock('UI/Components/PartyFriends/PartyFriends.js', () => ({ default: {} }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: {} }));
vi.mock('Renderer/ScreenEffectManager.js', () => ({ default: {} }));

const EntityEngine = (await import('Engine/MapEngine/Entity.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;

/** Invoke the handler init() hooked for a given packet structure. */
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
	mocks.messages = {};
	mocks.entityGet = () => null;
	mocks.itemNames = () => 'Item';
	mocks.chat.mockClear();

	EntityEngine();
});

describe('MVP reward messages', () => {
	it('shows the special EXP reward message with the awarded amount', () => {
		mocks.messages[145] = 'Congratulations! You are the MVP! Your reward EXP Points are';

		deliver(PACKET.ZC.MVP_GETTING_SPECIAL_EXP, { exp: 123456 });

		expect(mocks.chat).toHaveBeenNthCalledWith(
			1,
			'Congratulations! You are the MVP! Your reward EXP Points are',
			1 << 8,
			5
		);
		expect(mocks.chat).toHaveBeenNthCalledWith(2, '123456', 1 << 8, 5);
	});

	it('shows the overweight message when the MVP item could not be picked up', () => {
		mocks.messages[147] = "You are the MVP, but you can't take the reward because you are over your weight limit.";

		deliver(PACKET.ZC.THROW_MVPITEM, {});

		expect(mocks.chat).toHaveBeenCalledWith(
			"You are the MVP, but you can't take the reward because you are over your weight limit.",
			1 << 6,
			5
		);
	});
});

describe('party item pickup announcements', () => {
	beforeEach(() => {
		mocks.messages[1276] = '%s has acquired %s.';
	});

	it('names the picker and the item for the legacy 0x2b8 packet', () => {
		mocks.entityGet = AID => (AID === 150000 ? { display: { name: 'Eden' } } : null);
		mocks.itemNames = item => (item.ITID === 501 ? 'Red Potion' : 'Item');

		deliver(PACKET.ZC.ITEM_PICKUP_PARTY, {
			accountID: 150000,
			ITID: 501,
			IsIdentified: 1,
			IsDamaged: 0,
			RefiningLevel: 0,
			slot: { card1: 0, card2: 0, card3: 0, card4: 0 },
			location: 0,
			type: 0
		});

		expect(mocks.chat).toHaveBeenCalledWith('Eden has acquired Red Potion.', 1 << 8, 8);
	});

	it('names the picker and the item for the modern 0xb67 packet', () => {
		mocks.entityGet = AID => (AID === 150001 ? { display: { name: 'Freya' } } : null);
		mocks.itemNames = item => (item.ITID === 603 ? 'Yggdrasil Berry' : 'Item');

		deliver(PACKET.ZC.ITEM_PICKUP_PARTY2, {
			AID: 150001,
			ITID: 603,
			IsIdentified: 1,
			IsDamaged: 0,
			slot: { card1: 0, card2: 0, card3: 0, card4: 0 },
			location: 0,
			itemType: 0,
			RefiningLevel: 0,
			grade: 0
		});

		expect(mocks.chat).toHaveBeenCalledWith('Freya has acquired Yggdrasil Berry.', 1 << 8, 8);
	});

	// The 0xb67 struct names its enchant grade field "grade", but DB.getItemName
	// reads "enchantgrade" - without the mapping the bracket never renders.
	it('maps the 0xb67 grade field to enchantgrade for DB.getItemName', () => {
		let seenItem = null;
		mocks.entityGet = () => ({ display: { name: 'Freya' } });
		mocks.itemNames = item => {
			seenItem = item;
			return 'Item';
		};

		deliver(PACKET.ZC.ITEM_PICKUP_PARTY2, {
			AID: 150001,
			ITID: 603,
			IsIdentified: 1,
			IsDamaged: 0,
			slot: { card1: 0, card2: 0, card3: 0, card4: 0 },
			location: 0,
			itemType: 0,
			RefiningLevel: 0,
			grade: 3
		});

		expect(seenItem.enchantgrade).toBe(3);
	});

	it('falls back to an empty name when the picker is not on screen', () => {
		mocks.itemNames = () => 'Red Potion';

		deliver(PACKET.ZC.ITEM_PICKUP_PARTY, {
			accountID: 999999,
			ITID: 501,
			IsIdentified: 1,
			IsDamaged: 0,
			RefiningLevel: 0,
			slot: { card1: 0, card2: 0, card3: 0, card4: 0 },
			location: 0,
			type: 0
		});

		expect(mocks.chat).toHaveBeenCalledWith(' has acquired Red Potion.', 1 << 8, 8);
	});
});
