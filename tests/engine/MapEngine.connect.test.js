/**
 * tests/engine/MapEngine.connect.test.js
 *
 * A map server that cannot be reached: with auto-retry running the engine
 * goes back to char select to pick the same character again, otherwise it
 * keeps the error box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	connect: null,
	box: { remove: vi.fn() },
	charEngine: { reload: vi.fn() }
}));

vi.mock('Network/NetworkManager.js', () => ({
	default: {
		connect: (_ip, _port, callback) => {
			mocks.connect = callback;
		},
		hookPacket: vi.fn(),
		sendPacket: vi.fn(),
		setPing: vi.fn(),
		read: vi.fn(),
		close: vi.fn(),
		utils: { longToIP: () => '127.0.0.1' }
	}
}));
vi.mock('Engine/CharEngine.js', () => ({ default: mocks.charEngine }));
// The UIs the first init prepares ask the file thread for their assets
vi.mock('Core/Thread.js', () => ({ default: { send: vi.fn(), hook: vi.fn() } }));

// jsdom ships no 2d context, and the entity modules measure text at import.
HTMLCanvasElement.prototype.getContext = function () {
	return new Proxy(
		{
			canvas: this,
			measureText: () => ({ width: 0 }),
			getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
		},
		{ get: (ctx, key) => (key in ctx ? ctx[key] : () => {}) }
	);
};

const MapEngine = (await import('Engine/MapEngine.js')).default;
const UIManager = (await import('UI/UIManager.js')).default;
const AutoRetry = (await import('Engine/AutoRetry.js')).default;

/** Run MapEngine.init up to the connect answer, then fail it. */
function failConnect() {
	MapEngine.init(0, 5121, 'prontera.gat');
	mocks.connect(false);
}

describe('MapEngine.init, map server unreachable', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(UIManager, 'showErrorBox').mockImplementation(() => {});
		vi.spyOn(UIManager, 'showMessageBox').mockImplementation(() => mocks.box);
		mocks.charEngine.reload.mockClear();
		mocks.box.remove.mockClear();
		AutoRetry.disarm();
	});

	afterEach(() => {
		AutoRetry.setEnabled(false);
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('keeps the error box when auto-retry is off', async () => {
		AutoRetry.setEnabled(false);
		failConnect();

		expect(UIManager.showErrorBox).toHaveBeenCalledOnce();
		expect(UIManager.showMessageBox).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(mocks.charEngine.reload).not.toHaveBeenCalled();
	});

	it('goes back to char select to pick the character again once the connection gap ran out', async () => {
		AutoRetry.setEnabled(true);
		AutoRetry.arm(); // the character pick
		failConnect();

		expect(UIManager.showErrorBox).not.toHaveBeenCalled();
		expect(UIManager.showMessageBox).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(3499);
		expect(mocks.charEngine.reload).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.box.remove).toHaveBeenCalledOnce();
		expect(mocks.charEngine.reload).toHaveBeenCalledOnce();
		expect(mocks.charEngine.reload.mock.calls[0][1]).toBe(true);
		// Still counting: the re-picked attempt is the second one
		expect(AutoRetry.attempt()).toBe(1);
	});

	it('stops at char select without a re-pick when the box is clicked', async () => {
		AutoRetry.setEnabled(true);
		AutoRetry.arm();
		failConnect();

		const onOk = UIManager.showMessageBox.mock.calls[0][2];
		onOk();
		await vi.runAllTimersAsync();

		expect(AutoRetry.armed()).toBe(false);
		expect(mocks.charEngine.reload).toHaveBeenCalledOnce();
		expect(mocks.charEngine.reload.mock.calls[0][1]).toBeFalsy();
	});

	it('stops counting once the map server takes the connection', () => {
		AutoRetry.setEnabled(true);
		AutoRetry.arm();
		AutoRetry.arm();
		MapEngine.init(0, 5121, 'prontera.gat');
		mocks.connect(true);

		expect(AutoRetry.armed()).toBe(false);
	});
});
