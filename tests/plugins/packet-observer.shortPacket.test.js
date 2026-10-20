/**
 * tests/plugins/packet-observer.shortPacket.test.js
 *
 * A 2-byte packet (ZC_CLOSE_STORE) reaches its observers, alone in its buffer or
 * at the end of one.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	function CLOSE_STORE() {}
	CLOSE_STORE.id = 248;
	function COUNTINFO() {}
	COUNTINFO.id = 242;
	const read = function read() {};
	return {
		Network: { read },
		PACKET: { ZC: { CLOSE_STORE, COUNTINFO } },
		lengths: { 248: 2, 242: 6 }
	};
});

vi.mock('Plugins/native-manager/libs/plugin-api.js', () => ({
	Network: mocks.Network,
	PACKET: mocks.PACKET,
	PacketLength: { getPacketLength: id => mocks.lengths[id] || 0 }
}));

function reader(bytes) {
	const view = new DataView(new Uint8Array(bytes).buffer);
	let pos = 0;
	return {
		length: bytes.length,
		tell: () => pos,
		seek: p => {
			pos = p;
		},
		readUShort: () => {
			const v = view.getUint16(pos, true);
			pos += 2;
			return v;
		}
	};
}

describe('observePacket on a 2-byte packet', () => {
	it('fires for the packet alone in its buffer and at the end of one', async () => {
		const { observePacket } = await import('Plugins/native-manager/libs/packet-observer.js');
		const seen = [];
		observePacket(mocks.PACKET.ZC.CLOSE_STORE, () => seen.push('close'));

		mocks.Network.read.callback(reader([0xf8, 0x00]));
		mocks.Network.read.callback(reader([0xf2, 0x00, 1, 0, 2, 0, 0xf8, 0x00]));

		expect(seen).toEqual(['close', 'close']);
	});
});
