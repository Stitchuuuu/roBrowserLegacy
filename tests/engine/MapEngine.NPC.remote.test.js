/**
 * tests/engine/MapEngine.NPC.remote.test.js
 *
 * On a remote bot the bot answers the NPC dialog, the window only gets the server's pages: a page after
 * a Next or a menu replaces the previous one, a menu goes away with it, and a Close closes the box.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hooks: new Map(), active: true }));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		hookPacket: (struct, fn) => mocks.hooks.set(struct, fn),
		sendPacket: vi.fn()
	}
}));
vi.mock('Network/RemoteBot.js', () => ({ default: { isActive: () => mocks.active } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));

const NPCEngine = (await import('Engine/MapEngine/NPC.js')).default;
const PACKET = (await import('Network/PacketStructure.js')).default;
const NpcBox = (await import('UI/Components/NpcBox/NpcBox.js')).default;
const NpcMenu = (await import('UI/Components/NpcMenu/NpcMenu.js')).default;

const NAID = 110000123;

function deliver(struct, fields) {
	const pkt = Object.create(struct.prototype);
	Object.assign(pkt, { NAID }, fields);
	mocks.hooks.get(struct)(pkt);
}

const say = msg => deliver(PACKET.ZC.SAY_DIALOG, { msg });
const lines = () => [...NpcBox.getRoot().querySelectorAll('.content > div')].map(d => d.textContent);
const shown = sel => NpcBox.getRoot().querySelector(sel).style.display === 'block';

beforeEach(() => {
	mocks.hooks.clear();
	NpcBox.remove();
	NpcMenu.remove();
	NPCEngine();
});

describe('NPC dialog on a remote bot', () => {
	beforeEach(() => {
		mocks.active = true;
	});

	it('starts a fresh page on the text that follows a Next: one page at a time', () => {
		say('[Shion]');
		say('Welcome.');
		deliver(PACKET.ZC.WAIT_DIALOG, {});
		expect(lines()).toEqual(['[Shion]', 'Welcome.']);
		expect(shown('.next')).toBe(true);

		// The bot pressed Next: only the server's next page reaches the window.
		say('[Shion]');
		say('Talk to the Receptionist.');
		expect(lines()).toEqual(['[Shion]', 'Talk to the Receptionist.']);
		expect(shown('.next')).toBe(false);
	});

	it('takes the menu away and starts a fresh page when the text after it comes', () => {
		say('Where to?');
		deliver(PACKET.ZC.WAIT_DIALOG, {});
		// The bot's Next is answered by a menu: no Next button left over it.
		deliver(PACKET.ZC.MENU_LIST, { msg: 'Izlude:Prontera' });
		expect(NpcMenu.__active).toBe(true);
		expect(shown('.next')).toBe(false);
		expect(lines()).toEqual(['Where to?']);

		say('Off you go.');
		expect(NpcMenu.__active).toBe(false);
		expect(lines()).toEqual(['Off you go.']);
	});

	it('closes the box at once on a Close: there is no button the bot presses', () => {
		say('Good luck.');
		deliver(PACKET.ZC.CLOSE_DIALOG, {});
		expect(NpcBox.__active).toBe(false);
	});
});

describe('NPC dialog in a normal window', () => {
	beforeEach(() => {
		mocks.active = false;
	});

	it('keeps the page until its own Next, and waits for its own Close', () => {
		say('Welcome.');
		deliver(PACKET.ZC.WAIT_DIALOG, {});
		say('Still here.');
		expect(lines()).toEqual(['Welcome.', 'Still here.']);

		deliver(PACKET.ZC.CLOSE_DIALOG, {});
		expect(NpcBox.__active).toBe(true);
	});
});
