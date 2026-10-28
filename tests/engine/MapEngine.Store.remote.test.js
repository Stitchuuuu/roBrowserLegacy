/**
 * tests/engine/MapEngine.Store.remote.test.js
 *
 * On a remote bot the bot shops, the window only gets the server's packets: no Buy / Sell chooser the
 * window could answer, no close packet sent from the window when the bot's buy closes the store, and the
 * store closed when the bot walks away from it (it says so with a CLOSE_SCRIPT, the server with nothing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hooks: new Map(), active: true, sent: [] }));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: pkt => mocks.sent.push(pkt)
	}
}));
vi.mock('Network/RemoteBot.js', () => ({ default: { isActive: () => mocks.active } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));

const NPCEngine = (await import('Engine/MapEngine/NPC.js')).default;
const StoreEngine = (await import('Engine/MapEngine/Store.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;
const NpcStore = (await import('UI/Components/NpcStore/NpcStore.js')).default;
const WinPopup = (await import('UI/Components/WinPopup/WinPopup.js')).default;

const NAID = 110001736;

function deliver(struct, fields) {
	const pkt = Object.create(struct.prototype);
	Object.assign(pkt, { NAID }, fields);
	mocks.hooks.get(struct)(pkt);
}

const buyList = () => deliver(PACKET.ZC.PC_PURCHASE_ITEMLIST2, { itemList: [] });
// The close packet is NPC_TRADE_QUIT, or an empty purchase list on an older PACKETVER: whatever the window sends.
const quits = () => mocks.sent.length;

beforeEach(() => {
	mocks.hooks.clear();
	mocks.sent.length = 0;
	NpcStore.setClosePacketSent(true);
	NpcStore.remove();
	mocks.sent.length = 0;
	NPCEngine();
	StoreEngine();
});

describe('NPC shop on a remote bot', () => {
	beforeEach(() => {
		mocks.active = true;
	});

	it('opens no Buy / Sell chooser: the bot picks, the list that follows shows which', () => {
		const clone = vi.spyOn(WinPopup, 'clone');
		deliver(PACKET.ZC.SELECT_DEALTYPE, {});
		expect(clone).not.toHaveBeenCalled();
		clone.mockRestore();
	});

	it('closes the store on the buy result without a close packet of its own', () => {
		buyList();
		expect(NpcStore.__active).toBe(true);
		deliver(PACKET.ZC.PC_PURCHASE_RESULT, { result: 0 });
		expect(NpcStore.__active).toBe(false);
		expect(quits()).toBe(0);
	});

	it('closes the store when the bot walks away from it', () => {
		buyList();
		deliver(PACKET.ZC.CLOSE_SCRIPT, {});
		expect(NpcStore.__active).toBe(false);
		expect(quits()).toBe(0);
	});
});

describe('NPC shop in a normal window', () => {
	beforeEach(() => {
		mocks.active = false;
	});

	it('still closes the store with its own close packet after a buy', () => {
		buyList();
		deliver(PACKET.ZC.PC_PURCHASE_RESULT, { result: 0 });
		expect(NpcStore.__active).toBe(false);
		expect(quits()).toBe(1);
	});

	it('leaves the store alone on a CLOSE_SCRIPT', () => {
		buyList();
		deliver(PACKET.ZC.CLOSE_SCRIPT, {});
		expect(NpcStore.__active).toBe(true);
	});
});
