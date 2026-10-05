import { afterEach, describe, expect, it, vi } from 'vitest';

const list = {};
vi.mock('Core/Configs.js', () => ({ default: { get: () => list } }));

// Lets a run point at another copy of the module (e.g. the pre-fix one).
const MODULE = process.env.PLUGIN_MANAGER_UNDER_TEST || '../../src/Plugins/PluginManager.js';

async function initWith(entries) {
	Object.assign(list, entries);
	const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
	const { default: Plugins } = await import(/* @vite-ignore */ MODULE);
	Plugins.init();
	await new Promise(resolve => setTimeout(resolve, 200));
	return errors.mock.calls.map(args => String(args[0]));
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
	for (const key in list) {
		delete list[key];
	}
});

describe('PluginManager (v2) and native-manager entries', () => {
	it('does not try to load root-absolute or http(s) entries', async () => {
		const errors = await initWith({
			Native: '/plugins/x/x.esm.js',
			NativeWithPars: { path: '/plugins/y/y.esm.js', pars: { a: 1 } },
			Remote: 'https://example.com/z.esm.js'
		});
		expect(errors).toEqual([]);
	});

	it('still loads relative (v2) entries', async () => {
		const errors = await initWith({ Missing: 'DoesNotExist/Plugin' });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('./DoesNotExist/Plugin');
	});
});
