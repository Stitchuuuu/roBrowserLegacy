/**
 * tests/node/macro.test.js
 *
 * The offline half of /macro: chain splitting, the recursion / credential
 * guard, and the report-then-continue policy. Everything that touches a real
 * routine needs a live server, so the session here is a stub.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setSink } from '../../src/Node/log.js';
import macro, { splitSteps } from '../../src/Node/cli/commands/macro.js';
import { getCommand } from '../../src/Node/cli/registry.js';

let out = [];

beforeEach(() => {
	out = [];
	setSink(text => out.push(text));
});

afterEach(() => {
	setSink(null);
});

/** ctx stub: no routines ever arm, so nothing is persisted or started. */
function makeCtx(commands) {
	return {
		config: { account: { login: 'u' }, server: { charSlot: 0 }, characters: {} },
		session: {
			listRoutines: () => [],
			getRoutine: () => null,
			stopRoutine: () => false
		},
		client: {
			on: () => {}
		},
		getCommand: name => commands[name] || null
	};
}

const joined = () => out.join('\n');

describe('registration', () => {
	it('is reachable through the registry the REPL dispatches on', () => {
		expect(getCommand('macro')).toBe(macro);
	});
});

describe('splitSteps', () => {
	it('splits on a spaced separator', () => {
		expect(splitSteps(['autobuff', 'xp', ';', 'autoheal', 'party'])).toEqual([
			['autobuff', 'xp'],
			['autoheal', 'party']
		]);
	});

	it('splits a separator glued to its neighbours', () => {
		expect(splitSteps(['autobuff', 'xp;autoheal', 'party'])).toEqual([
			['autobuff', 'xp'],
			['autoheal', 'party']
		]);
	});

	it('drops empty steps (doubled and trailing separators)', () => {
		expect(splitSteps(['a', ';', ';', 'b', ';'])).toEqual([['a'], ['b']]);
		expect(splitSteps([';'])).toEqual([]);
		expect(splitSteps([])).toEqual([]);
	});

	it('keeps a single step whole', () => {
		expect(splitSteps(['say', 'hello', 'world'])).toEqual([['say', 'hello', 'world']]);
	});
});

describe('/macro save guards', () => {
	it('refuses a macro that calls /macro (recursion)', async () => {
		await macro.run(makeCtx({ macro }), ['save', 'boum', 'macro', 'xp']);
		expect(joined()).toContain('not allowed in a macro');
		expect(joined()).toContain('macro not saved');
	});

	it('refuses a macro that carries /login (password would be persisted)', async () => {
		const login = { name: 'login', run: () => {} };
		await macro.run(makeCtx({ login }), ['save', 'boot', 'login', 'user', 'secret']);
		expect(joined()).toContain('not allowed in a macro');
	});

	it('refuses a macro with an unknown step', async () => {
		await macro.run(makeCtx({}), ['save', 'oops', 'nope', 'x']);
		expect(joined()).toContain('unknown command');
		expect(joined()).toContain('macro not saved');
	});
});

describe('/macro one-shot chain', () => {
	it('runs every step and reports the failures instead of aborting', async () => {
		const ran = [];
		const ok = { name: 'ok', run: (ctx, args) => ran.push(args.join(' ')) };
		await macro.run(makeCtx({ ok }), ['ok', 'one', ';', 'nope', 'two', ';', 'ok', 'three']);

		expect(ran).toEqual(['one', 'three']); // the bad step did not stop the chain
		expect(joined()).toContain('unknown command');
		expect(joined()).toContain('2/3 ok — 1 failed');
	});

	it('reports a throwing step and keeps going', async () => {
		const boom = {
			name: 'boom',
			run: () => {
				throw new Error('nope');
			}
		};
		const ok = { name: 'ok', run: () => {} };
		await macro.run(makeCtx({ boom, ok }), ['boom', ';', 'ok']);
		expect(joined()).toContain('nope');
		expect(joined()).toContain('1/2 ok — 1 failed');
	});
});
