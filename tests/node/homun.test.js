/**
 * tests/node/homun.test.js
 *
 * The two pieces of the homunculus-buff path that can be proven offline: the
 * pre-renewal duration table (the timer's only source of truth, since a
 * homunculus never reports its status) and HomunState's packet decoding.
 * Everything else in the path needs a live server.
 */
import { describe, it, expect } from 'vitest';
import SkillConst from 'DB/Skills/SkillConst.js';
import { buffEfst, buffDuration } from '../../src/Node/resolve/buffMap.js';
import { HomunState } from '../../src/Node/state/homun.js';

describe('buffMap durations (pre-re skill_db Duration1)', () => {
	it('keeps buffEfst behaviour', () => {
		expect(buffEfst(SkillConst.AL_BLESSING)).toBe(10);
		expect(buffEfst(SkillConst.PR_MAGNIFICAT)).toBe(20);
		expect(buffEfst(99999)).toBe(null);
	});

	it('Blessing / IncAgi: 60s at lv1, 240s at lv10', () => {
		expect(buffDuration(SkillConst.AL_BLESSING, 1)).toBe(60000);
		expect(buffDuration(SkillConst.AL_BLESSING, 10)).toBe(240000);
		expect(buffDuration(SkillConst.AL_INCAGI, 10)).toBe(240000);
	});

	it('Kyrie flat 120s, Impositio flat 60s', () => {
		expect(buffDuration(SkillConst.PR_KYRIE, 1)).toBe(120000);
		expect(buffDuration(SkillConst.PR_KYRIE, 10)).toBe(120000);
		expect(buffDuration(SkillConst.PR_IMPOSITIO, 5)).toBe(60000);
	});

	it('Aspersio 60s→180s, Suffragium inverted 30s→10s', () => {
		expect(buffDuration(SkillConst.PR_ASPERSIO, 1)).toBe(60000);
		expect(buffDuration(SkillConst.PR_ASPERSIO, 5)).toBe(180000);
		expect(buffDuration(SkillConst.PR_SUFFRAGIUM, 1)).toBe(30000);
		expect(buffDuration(SkillConst.PR_SUFFRAGIUM, 3)).toBe(10000);
	});

	it('unmapped / duration-less returns null', () => {
		expect(buffDuration(SkillConst.PR_MAGNIFICAT, 5)).toBe(null);
		expect(buffDuration(99999, 1)).toBe(null);
	});
});

describe('HomunState packet decoding', () => {
	const stand = (gid, x, y, type = 8) => ({ objecttype: type, GID: gid, name: 'Pochita', PosDir: [x, y, 4] });
	const walk = (gid, x2, y2) => ({ objecttype: 8, GID: gid, name: 'Pochita', MoveData: [0, 0, x2, y2, 0, 0] });

	it('tracks TYPE_HOM only, keyed by GID, emitting spawn once', () => {
		const s = new HomunState();
		const spawns = [];
		s.on('spawn', e => spawns.push(e.gid));

		s._onEntry(stand(110000001, 150, 120), stand(110000001, 150, 120).PosDir, 0);
		s._onEntry(stand(110000002, 10, 10, 0), stand(110000002, 10, 10, 0).PosDir, 0); // a PC — ignored
		expect(s.list().map(h => h.gid)).toEqual([110000001]);
		expect(s.get(110000001)).toMatchObject({ name: 'Pochita', x: 150, y: 120 });

		// re-entering view refreshes silently, no second spawn
		s._onEntry(stand(110000001, 151, 121), [151, 121, 4], 0);
		expect(spawns).toEqual([110000001]);
		expect(s.get(110000001)).toMatchObject({ x: 151, y: 121 });
	});

	it('reads the destination cell from a walking entry / NOTIFY_MOVE', () => {
		const s = new HomunState();
		const pkt = walk(110000003, 200, 90);
		s._onEntry(pkt, pkt.MoveData, 2);
		expect(s.get(110000003)).toMatchObject({ x: 200, y: 90 });

		s._move(110000003, [200, 90, 205, 95, 0, 0], 2);
		expect(s.get(110000003)).toMatchObject({ x: 205, y: 95 });
	});

	it('vanish removes, records lastSeen and clears ownId', () => {
		const s = new HomunState();
		s._onEntry(stand(110000004, 5, 5), [5, 5, 0], 0);
		s.ownId = 110000004;

		const gone = [];
		s.on('vanish', e => gone.push(e.gid));
		s._vanish(110000004);

		expect(s.get(110000004)).toBe(null);
		expect(s.getOwnId()).toBe(0);
		expect(gone).toEqual([110000004]);
		expect(s.lastSeenAt(110000004)).toBeGreaterThan(0);
		// an unknown gid vanishing is a no-op
		s._vanish(999);
		expect(gone).toEqual([110000004]);
	});

	it('map change drops every unit but keeps lastSeen', () => {
		const s = new HomunState();
		s._onEntry(stand(110000005, 1, 1), [1, 1, 0], 0);
		s.ownId = 110000005;
		s._clear();
		expect(s.list()).toEqual([]);
		expect(s.getOwnId()).toBe(0);
		expect(s.lastSeenAt(110000005)).toBeGreaterThan(0);
	});
});
