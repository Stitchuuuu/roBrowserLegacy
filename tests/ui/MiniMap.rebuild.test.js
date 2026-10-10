/**
 * tests/ui/MiniMap.rebuild.test.js
 *
 * The minimap restarted in place by a map transition.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: null, rects: [] }));

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '', getTownInfo: () => null, mapalias: {} } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: { Entity: { position: [50, 50], direction: 0 } } }));
vi.mock('Renderer/Renderer.js', () => ({
	default: { width: 1200, height: 800, tick: 0, render: fn => (mocks.render = fn), stop: vi.fn() }
}));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { width: 100, height: 100 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));

// jsdom has no 2D context: record the party dots' white squares.
HTMLCanvasElement.prototype.getContext = function () {
	return new Proxy(
		{ fillRect: (x, y, w, h) => mocks.rects.push([w, h]) },
		{ get: (target, key) => (key in target ? target[key] : () => {}) }
	);
};

const { createMiniMap } = await import('UI/Components/MiniMap/MiniMapCommon.js');
const MiniMap = createMiniMap({ name: 'MiniMapTest', htmlText: '<div><canvas></canvas><div class="plus"></div><div class="minus"></div></div>', cssText: '' });

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

function partyDots() {
	mocks.rects.length = 0;
	mocks.render(0);
	return mocks.rects.filter(([w, h]) => w === 6 && h === 6).length;
}

/**
 * The server sends the party members' positions once the map is loaded:
 * emptying them at the transition hid the members standing still.
 */
describe('MiniMap rebuilt in place by a map transition', () => {
	beforeAll(() => {
		MiniMap.append();
		MiniMap.setMap('prontera.gat');
	});

	beforeEach(() => {
		MiniMap.addPartyMemberMark(1, 40, 40);
	});

	it('keeps the party members on a teleport within the map', () => {
		MiniMap.rebuild();
		MiniMap.setMap('prontera.gat');

		expect(partyDots()).toBe(1);
	});

	it('drops them on a change of map', () => {
		MiniMap.rebuild();
		MiniMap.setMap('prt_fild08.gat');

		expect(partyDots()).toBe(0);
	});

	it('drops them when it is removed', () => {
		MiniMap.remove();
		MiniMap.append();

		expect(partyDots()).toBe(0);
	});
});
