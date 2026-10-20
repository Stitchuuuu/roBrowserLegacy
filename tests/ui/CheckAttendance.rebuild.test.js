/**
 * tests/ui/CheckAttendance.rebuild.test.js
 *
 * The attendance window restarted in place by a map transition.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const addText = vi.fn();

vi.mock('UI/CursorManager.js', () => ({ default: { ACTION: {}, getActualType: vi.fn(), setType: vi.fn() } }));
vi.mock('Core/Preferences.js', () => ({ default: { get: (_name, defaults) => ({ ...defaults, save: vi.fn() }) } }));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));
vi.mock('UI/Elements/Elements.js', () => ({}));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '', getMessage: () => '', getCheckAttendanceInfo: () => null } }));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn(), loadFiles: vi.fn() } }));
vi.mock('Network/NetworkManager.js', () => ({ default: { sendPacket: vi.fn() } }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: { addText, TYPE: { ERROR: 1, SELF: 2 } } }));

const CheckAttendance = (await import('UI/Components/CheckAttendance/CheckAttendance.js')).default;

// prepare() schedules scrollbar checks up to 500 ms out; let the last ones
// land before jsdom is torn down.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

/**
 * Without an event the window prints a notice in the chat when it is
 * appended; the map transition appended it again on every teleport.
 */
describe('CheckAttendance without an event', () => {
	beforeEach(() => {
		addText.mockClear();
	});

	it('tells the player once, when it is first appended', () => {
		CheckAttendance.append();

		expect(addText).toHaveBeenCalledOnce();
	});

	it('stays silent when a map transition restarts it', () => {
		CheckAttendance.rebuild();

		expect(addText).not.toHaveBeenCalled();
	});
});
