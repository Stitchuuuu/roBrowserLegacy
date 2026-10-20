import { beforeEach, describe, expect, it, vi } from 'vitest';

// onUIOpen is module-private and only reachable through the hook init()
// registers, so the Network mock keeps the packet struct -> handler map.
const mocks = vi.hoisted(() => ({
	hooks: new Map(),
	enableBank: true,
	bank: { openRequest: vi.fn(), __active: false }
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn)
	}
}));

vi.mock('Core/Configs.js', () => ({
	default: { get: key => (key === 'enableBank' ? mocks.enableBank : false) }
}));

vi.mock('UI/Components/Bank/Bank.js', () => ({ default: mocks.bank }));
vi.mock('UI/Components/CheckAttendance/CheckAttendance.js', () => ({
	default: { prepare: vi.fn(), setData: vi.fn(), cleanUI: vi.fn(), append: vi.fn(), ui: { show: vi.fn() }, focus: vi.fn() }
}));
vi.mock('UI/Components/EnchantGrade/EnchantGrade.js', () => ({
	default: { prepare: vi.fn(), onOpenEnchantGradeUI: vi.fn() }
}));
vi.mock('UI/Components/Enchant/Enchant.js', () => ({ default: { prepare: vi.fn(), onOpenEnchantUI: vi.fn() } }));

const UIOpenEngine = (await import('Engine/MapEngine/UIOpen.js')).default;
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
	mocks.enableBank = true;
	mocks.bank.openRequest.mockClear();
	mocks.bank.__active = false;

	UIOpenEngine();
});

describe('UI_OPEN BANK_UI (type 0)', () => {
	it('requests the bank open when the feature is enabled', () => {
		deliver(PACKET.ZC.UI_OPEN, { ui_type: 0, data: 0 });

		expect(mocks.bank.openRequest).toHaveBeenCalled();
	});

	it('does nothing when banking is disabled', () => {
		mocks.enableBank = false;

		deliver(PACKET.ZC.UI_OPEN, { ui_type: 0, data: 0 });

		expect(mocks.bank.openRequest).not.toHaveBeenCalled();
	});
});
