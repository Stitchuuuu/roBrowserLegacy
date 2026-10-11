import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same hook-capture pattern as tests/engine/MapEngine.Guild.test.js: the packet
// handlers in Engine/MapEngine/Skill.js are module-private, reachable only
// through the hooks init() registers on the Network mock.
const mocks = vi.hoisted(() => ({
	hooks: new Map(),
	skillWindow: {
		removeSkill: vi.fn(),
		setSkills: vi.fn(),
		addSkill: vi.fn(),
		updateSkill: vi.fn(),
		useSkill: vi.fn(),
		getSkillById: vi.fn()
	}
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: vi.fn()
	}
}));

vi.mock('UI/Components/SkillList/SkillList.js', () => ({ default: mocks.skillWindow }));
vi.mock('UI/Components/Guild/Guild.js', () => ({ default: {} }));
vi.mock('UI/Components/SkillListMH/SkillListMH.js', () => ({
	default: { homunculus: {}, mercenary: {} }
}));
vi.mock('UI/Components/ShortCut/ShortCut.js', () => ({ default: {} }));
vi.mock('UI/Components/SkillTargetSelection/SkillTargetSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/ItemSelection/ItemSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/MakeArrowSelection/MakeArrowSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/RefineWeaponSelection/RefineWeaponSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: {} }));
vi.mock('UI/Components/NpcMenu/NpcMenu.js', () => ({ default: {} }));
vi.mock('UI/Components/Sense/Sense.js', () => ({ default: {} }));
vi.mock('UI/Components/Announce/Announce.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({
	default: { addText: vi.fn(), TYPE: {}, FILTER: {} }
}));
vi.mock('UI/Components/CartDecoration/CartDecoration.js', () => ({ default: { onSelectCart: vi.fn() } }));
vi.mock('UI/UIManager.js', () => ({ default: {} }));
vi.mock('DB/DBManager.js', () => ({ default: { getMessage: vi.fn() } }));
vi.mock('DB/Skills/SkillConst.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillInfo.js', () => ({ default: {} }));
vi.mock('DB/Effects/EffectConst.js', () => ({ default: {} }));
vi.mock('Utils/PathFinding.js', () => ({ default: { search: vi.fn() } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: {} }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20211103 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Renderer/EffectManager.js', () => ({
	default: { spam: vi.fn(), spamSkill: vi.fn(), remove: vi.fn() }
}));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: vi.fn(), TYPE: {} } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { tick: 0 } }));
vi.mock('Renderer/Effects/SnowWeather.js', () => ({ default: { stop: vi.fn() } }));
vi.mock('Renderer/Effects/RainWeather.js', () => ({ default: { stop: vi.fn() } }));
vi.mock('Renderer/Effects/PokJukWeatherEffect.js', () => ({ default: { stop: vi.fn() } }));
vi.mock('Renderer/Effects/SakuraWeatherEffect.js', () => ({ default: { stop: vi.fn() } }));
vi.mock('Renderer/Effects/CloudWeatherEffect.js', () => ({ default: { stop: vi.fn() } }));

const SkillEngine = (await import('Engine/MapEngine/Skill.js')).default;
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
	mocks.skillWindow.removeSkill.mockClear();
	SkillEngine();
});

// rAthena sends 0x441 (ZC_SKILLINFO_DELETE) from pc_skill (skill reset to
// level 0), pc_skill_plagiarism_reset (Plagiarism/Reproduce cleared),
// chrif_deadopt (lost WE_CALLBABY) and the @skillid atcommand (forgotten
// quest skill) - none of those call sites are gated to Renewal.
describe('a skill leaving the tree (ZC_SKILLINFO_DELETE)', () => {
	it('tells the skill window to drop it', () => {
		deliver(PACKET.ZC.SKILLINFO_DELETE, { SKID: 143 });

		expect(mocks.skillWindow.removeSkill).toHaveBeenCalledWith(143);
	});
});
