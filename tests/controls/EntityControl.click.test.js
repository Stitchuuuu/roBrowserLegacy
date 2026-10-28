import { beforeEach, describe, expect, it, vi } from 'vitest';

// A left click on an entity runs `stop || onMouseDown()` then `stop || onFocus()`
// (MapControl), and onFocus is what locks a player on and sends the attack: a
// player's onMouseDown must only claim the click when the captcha selector takes it.
const mocks = vi.hoisted(() => ({
	session: { captchaGetIdOnEntityClick: false, Entity: {} },
	captcha: { addPlayer: vi.fn() }
}));

vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('UI/Components/Captcha/CaptchaSelector.js', () => ({ default: mocks.captcha }));
vi.mock('Network/NetworkManager.js', () => ({ default: { sendPacket: vi.fn(), hookPacket: vi.fn() } }));
vi.mock('UI/CursorManager.js', () => ({ default: { setType: vi.fn(), ACTION: {} } }));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatRoom/ChatRoom.js', () => ({ default: {} }));
vi.mock('UI/Components/ContextMenu/ContextMenu.js', () => ({ default: {} }));
vi.mock('UI/Components/PetInformations/PetInformations.js', () => ({ default: {} }));
vi.mock('UI/Components/Trade/Trade.js', () => ({ default: {} }));
vi.mock('UI/Components/NpcBox/NpcBox.js', () => ({ default: {} }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: {} }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: {} }));
vi.mock('UI/Components/PartyFriends/PartyFriends.js', () => ({ default: {} }));
vi.mock('UI/Components/HomunInformations/HomunInformations.js', () => ({ default: {} }));
vi.mock('UI/Components/MercenaryInformations/MercenaryInformations.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine/Friends.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine/Guild.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine/Group.js', () => ({ default: {} }));

const Init = (await import('Controls/EntityControl.js')).default;

class FakeEntity {
	static TYPE_PC = 0;
}

function player() {
	const entity = new FakeEntity();
	entity.objecttype = FakeEntity.TYPE_PC;
	entity.GID = 2000172;
	Init.call(entity);
	return entity;
}

beforeEach(() => {
	mocks.session.captchaGetIdOnEntityClick = false;
	mocks.captcha.addPlayer.mockClear();
});

describe('EntityControl.onMouseDown on a player', () => {
	it('leaves the click to onFocus (the attack) when no captcha is picking players', () => {
		expect(player().onMouseDown()).toBe(false);
		expect(mocks.captcha.addPlayer).not.toHaveBeenCalled();
	});

	it('claims the click for the captcha selector while it picks players', () => {
		mocks.session.captchaGetIdOnEntityClick = true;
		expect(player().onMouseDown()).toBe(true);
		expect(mocks.captcha.addPlayer).toHaveBeenCalledWith(2000172);
	});
});
