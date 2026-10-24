/**
 * tests/plugins/woe-hostility.lib.test.js
 *
 * woe-hostility lib: handed to plugins as deps.libs['woe-hostility'], and its
 * hostileTargets() picks the enemy players and the Emperium on a GvG map.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OUR_GUILD = 13;
const ENEMY_GUILD = 36;

function entity(fields) {
	return { GID: 0, objecttype: 0, GUID: 0, action: 0, ACTION: { DIE: 8 }, position: [50, 50, 0], ...fields };
}

describe('woe-hostility lib', () => {
	let entities;
	let session;

	beforeEach(() => {
		vi.resetModules();
		const self = entity({ GID: 1, GUID: OUR_GUILD });
		session = { Entity: self, mapState: { isGVG: true }, hasGuild: true, hasParty: false, AID: 1 };
		entities = [
			self,
			entity({ GID: 2, GUID: ENEMY_GUILD, position: [52, 50, 0] }),
			entity({ GID: 3, GUID: OUR_GUILD, position: [51, 50, 0] }),
			entity({ GID: 4, objecttype: 5, job: 1288, GUID: ENEMY_GUILD, position: [55, 50, 0] })
		];
		vi.doMock('Plugins/native-manager/libs/plugin-api.js', () => ({
			Session: session,
			EntityManager: { forEach: cb => entities.forEach(cb) },
			PACKET: { ZC: {}, CZ: {} },
			Network: { sendPacket: () => undefined }
		}));
		vi.doMock('Plugins/native-manager/libs/packet-observer.js', () => ({ observePacket: () => () => true, observeSendPacket: () => () => true }));
	});

	it('is in the DI map under its lib name', async () => {
		// di.js gathers every lib; only woe-hostility is under test here.
		for (const lib of ['engine-modules.js', 'legacy-ui-component.js', 'libs/ui.js', 'libs/lifecycle.js', 'libs/icons.js', 'libs/socket-observer.js', 'libs/dev-log.js', 'libs/fetch-intercept.js']) {
			vi.doMock('Plugins/native-manager/' + lib, () => ({ ENGINE: {}, default: {}, fetchIntercept: {}, devLog: () => undefined, observeSocket: () => undefined, icon: () => undefined }));
		}
		const { buildDiMap } = await import('Plugins/native-manager/di.js');
		const lib = buildDiMap().libs['woe-hostility'];
		expect(typeof lib.hostileTargets).toBe('function');
		expect(typeof lib.isHostile).toBe('function');
	});

	it('lists the enemy player, then the Emperium, on a GvG map', async () => {
		const lib = await import('Plugins/native-manager/libs/woe-hostility/index.js');
		expect(lib.hostileTargets().map(t => [t.gid, t.kind])).toEqual([
			[2, 'player'],
			[4, 'emperium']
		]);
	});

	it('lists no player outside a GvG or PvP map', async () => {
		session.mapState = {};
		const lib = await import('Plugins/native-manager/libs/woe-hostility/index.js');
		expect(lib.hostileTargets()).toEqual([]);
	});
});
