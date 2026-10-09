/**
 * tests/plugins/NativePluginManager.test.js
 *
 * Init-failure status: a false return or a throw is recorded as `{ status:
 * 'failed', error }` (boot and runtime), surfaced via `PluginHost.list()`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const configValues = {
	fetchIntercept: false,
	plugins: {
		BootOk: '/tests/plugins/fixtures/boot-ok.esm.js',
		BootUndefined: '/tests/plugins/fixtures/boot-undefined.esm.js',
		BootFalse: '/tests/plugins/fixtures/boot-false.esm.js',
		BootThrow: '/tests/plugins/fixtures/boot-throw.esm.js',
		Consumer: '/tests/plugins/fixtures/consumer.esm.js',
		CaptureHost: '/tests/plugins/fixtures/capture-host.esm.js'
	}
};
vi.mock('Core/Configs.js', () => ({ default: { get: (key, def) => (key in configValues ? configValues[key] : def) } }));

// Engine modules that crash at import-time under jsdom (canvas) or aren't
// relevant here. Same set as tests/plugins/LegacyUIComponent.icons.test.js.
vi.mock('UI/CursorManager.js', () => ({
	default: { ACTION: { DEFAULT: 0 }, getActualType: vi.fn(() => 0), setType: vi.fn() }
}));
vi.mock('DB/DBManager.js', () => ({ default: { INTERFACE_PATH: '' } }));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile(_path, callback) {
			callback?.('');
		},
		loadFiles(_paths, callback) {
			callback?.('', '');
		}
	}
}));
vi.mock('Renderer/Renderer.js', () => ({ default: { width: 1200, height: 800 } }));
vi.mock('Renderer/EntityManager.js', () => ({ default: { setOverEntity: vi.fn() } }));
vi.mock('Renderer/Entity/Entity.js', () => ({ default: class Entity {} }));
vi.mock('UI/Scrollbar.js', () => ({ default: {} }));

let host;

beforeAll(async () => {
	window.ROConfig = {};
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	const { default: NativePluginManager } = await import('Plugins/native-manager/index.js');
	await NativePluginManager.init();
	host = window.__capturedHost;
}, 30000); // the full engine-module import chain is slow under a busy worker pool

afterAll(() => {
	vi.restoreAllMocks();
	delete window.__capturedHost;
	delete window.__consumedFalse;
});

describe('boot: registration status', () => {
	it('is ok for a value return', () => {
		expect(host.list()).toContainEqual({ name: 'BootOk', status: 'ok' });
	});

	it('is ok for an undefined return', () => {
		expect(host.list()).toContainEqual({ name: 'BootUndefined', status: 'ok' });
	});

	it('is failed with a synthetic message for a false return', () => {
		expect(host.list()).toContainEqual({ name: 'BootFalse', status: 'failed', error: 'init() returned false' });
	});

	it('is failed with the thrown message for a throwing init', () => {
		expect(host.list()).toContainEqual({ name: 'BootThrow', status: 'failed', error: 'boot boom' });
	});

	it('still injects false into a consumer declaring the failed producer as a dep', () => {
		expect(window.__consumedFalse).toBe(false);
	});
});

describe('runtime: PluginHost.register / unregister', () => {
	it('resolves false (does not reject) on an init throw, recording failed', async () => {
		const ret = await host.register({ name: 'RtThrow', init: () => { throw new Error('rt boom'); } }, null, null);
		expect(ret).toBe(false);
		expect(host.list()).toContainEqual({ name: 'RtThrow', status: 'failed', error: 'rt boom' });
	});

	it('resolves false on a false return, recording failed', async () => {
		const ret = await host.register({ name: 'RtFalse', init: () => false }, null, null);
		expect(ret).toBe(false);
		expect(host.list()).toContainEqual({ name: 'RtFalse', status: 'failed', error: 'init() returned false' });
	});

	it('resolves the init return on success, recording ok', async () => {
		const ret = await host.register({ name: 'RtOk', init: () => 'value' }, null, null);
		expect(ret).toBe('value');
		expect(host.list()).toContainEqual({ name: 'RtOk', status: 'ok' });
	});

	it('still rejects on a shape error (missing init)', async () => {
		await expect(host.register({ name: 'RtBad' }, null, null)).rejects.toThrow('invalid plugin (missing init)');
	});

	it('unregister removes a failed entry', async () => {
		await host.register({ name: 'RtToRemove', init: () => false }, null, null);
		expect(host.list().some(p => p.name === 'RtToRemove')).toBe(true);
		host.unregister('RtToRemove');
		expect(host.list().some(p => p.name === 'RtToRemove')).toBe(false);
	});
});
