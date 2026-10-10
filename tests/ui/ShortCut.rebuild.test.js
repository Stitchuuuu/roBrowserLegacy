/**
 * tests/ui/ShortCut.rebuild.test.js
 *
 * The shortcut bar restarted in place by a map transition.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '', getMessage: () => '', UpdateOwnerName: {} } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Core/Configs.js', () => ({ default: { get: vi.fn() } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800, tick: 0 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Components/ItemInfo/ItemInfo.js', () => ({ default: {} }));
vi.mock('UI/Components/Inventory/Inventory.js', () => ({ default: { getUI: () => ({}) } }));
vi.mock('UI/Components/SkillListMH/SkillListMH.js', () => ({
	default: { homunculus: { getSkillById: () => null }, mercenary: { getSkillById: () => null } }
}));
vi.mock('UI/Components/SkillDescription/SkillDescription.js', () => ({ default: {} }));
vi.mock('UI/Components/SkillTargetSelection/SkillTargetSelection.js', () => ({ default: {} }));
vi.mock('UI/Components/Guild/Guild.js', () => ({ default: { getSkillById: () => null } }));
vi.mock('UI/Components/SkillList/SkillList.js', () => ({ default: { getUI: () => ({ getSkillById: () => null }) } }));

const ShortCut = (await import('UI/Components/ShortCut/ShortCut.js')).default;

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

/**
 * The bar stays on screen through a teleport: stopping a cooldown there left
 * its overlay frozen on the slot until the skill was cast again.
 */
describe('ShortCut rebuilt in place by a map transition', () => {
	beforeAll(() => {
		ShortCut.append();
		ShortCut.setList([{ isSkill: true, ID: 28, count: 1 }]);
	});

	it('lets a running cooldown go on', () => {
		ShortCut.setSkillDelay(28, 5000);
		const cancel = vi.spyOn(window, 'cancelAnimationFrame');

		ShortCut.onRemove(true);

		expect(cancel).not.toHaveBeenCalled();
		cancel.mockRestore();
	});

	it('still stops it when the bar is removed', () => {
		ShortCut.setSkillDelay(28, 10000);
		const cancel = vi.spyOn(window, 'cancelAnimationFrame');

		ShortCut.onRemove();

		expect(cancel).toHaveBeenCalled();
		cancel.mockRestore();
	});
});
