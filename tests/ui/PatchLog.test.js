import { describe, it, expect } from 'vitest';
import PatchLog from 'UI/Components/PatchNotes/PatchLog.js';

const RELEASES = [
	{ version: '0.1.0', date: '2026-10-18', title: 'First', sha: 'aaaaaaa1111111', notes: [] },
	{ version: '0.2.0', date: '2026-11-02', title: 'Second', sha: 'bbbbbbb2222222', notes: [] },
	{ version: '0.2.1', date: '2026-11-05', title: 'Third', sha: 'ccccccc3333333', notes: [] }
];

describe('PatchLog.compare', () => {
	it('orders versions numerically', () => {
		expect(PatchLog.compare('0.10.0', '0.9.9')).toBeGreaterThan(0);
		expect(PatchLog.compare('0.2.0', '0.2.1')).toBeLessThan(0);
		expect(PatchLog.compare('1.0.0', '1.0.0')).toBe(0);
	});
});

describe('PatchLog.current', () => {
	it('maps a released sha to its version', () => {
		expect(PatchLog.current(RELEASES, 'bbbbbbb2222222').version).toBe('0.2.0');
	});

	it('matches a short sha', () => {
		expect(PatchLog.current(RELEASES, 'bbbbbbb').version).toBe('0.2.0');
	});

	it('falls back to the latest release for an unknown sha', () => {
		expect(PatchLog.current(RELEASES, 'ddddddd').version).toBe('0.2.1');
	});

	it('falls back to the latest release without a sha', () => {
		expect(PatchLog.current(RELEASES, '').version).toBe('0.2.1');
	});

	it('returns null for an empty log', () => {
		expect(PatchLog.current([], 'aaaaaaa')).toBe(null);
	});
});

describe('PatchLog.unseen', () => {
	it('returns the running release alone on a first visit', () => {
		expect(PatchLog.unseen(RELEASES, '0.2.0', null).map(r => r.version)).toEqual(['0.2.0']);
	});

	it('returns every release since the seen one, newest first', () => {
		expect(PatchLog.unseen(RELEASES, '0.2.1', '0.1.0').map(r => r.version)).toEqual(['0.2.1', '0.2.0']);
	});

	it('returns nothing for the same version', () => {
		expect(PatchLog.unseen(RELEASES, '0.2.0', '0.2.0')).toEqual([]);
	});

	it('returns nothing on a rollback', () => {
		expect(PatchLog.unseen(RELEASES, '0.1.0', '0.2.1')).toEqual([]);
	});
});

describe('PatchLog.sorted', () => {
	it('lists releases newest first', () => {
		expect(PatchLog.sorted([RELEASES[1], RELEASES[2], RELEASES[0]]).map(r => r.version)).toEqual([
			'0.2.1',
			'0.2.0',
			'0.1.0'
		]);
	});
});
