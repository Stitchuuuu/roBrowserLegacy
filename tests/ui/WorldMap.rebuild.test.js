/**
 * tests/ui/WorldMap.rebuild.test.js
 *
 * The world map built only once it is shown.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const loadFile = vi.fn();
const worldImage = () => loadFile.mock.calls.filter(([path]) => /^worldmap/.test(path));

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '', getMessage: () => '' } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile, loadFiles: vi.fn() } }));
vi.mock('Core/Configs.js', () => ({ default: { get: (_key, value) => value } }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: { currentMap: 'prontera.gat' } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: {} }));
vi.mock('UI/Components/Navigation/Navigation.js', () => ({ default: {} }));

const WorldMap = (await import('UI/Components/WorldMap/WorldMap.js')).default;

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

/**
 * Every map transition appends the world map again: building its whole view
 * there, hidden, was the longest task on arriving in a town.
 */
describe('WorldMap', () => {
	it('does not build its view while it is hidden', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		WorldMap.append();

		expect(worldImage()).toHaveLength(0);
	});

	it('builds it when it is opened', () => {
		WorldMap.toggle();

		expect(worldImage()).toHaveLength(1);
	});
});
