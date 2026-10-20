import { afterEach, describe, expect, it } from 'vitest';
import PACKET from 'Network/PacketStructure.js';
import PACKETVER from 'Network/PacketVerManager.js';
import BinaryReader from 'Utils/BinaryReader.js';

// ZC_ACK_WEAPONREFINE (0x0223) widens the item id from a short to a long at
// packetver 20181121, the same step as every other item id on the wire.

function parse(bytes) {
	const buf = new ArrayBuffer(bytes.length);
	new Uint8Array(buf).set(bytes);
	return new PACKET.ZC.ACK_WEAPONREFINE(new BinaryReader(buf), buf.byteLength);
}

const RESULT = [3, 0, 0, 0];
const saved = PACKETVER.value;

afterEach(() => {
	PACKETVER.value = saved;
});

describe('PACKET.ZC.ACK_WEAPONREFINE (0x0223)', () => {
	it('reads a short item id before 20181121', () => {
		PACKETVER.value = 20180620;
		const pkt = parse([...RESULT, 0xb1, 0x04]);

		expect(pkt.msg).toBe(3);
		expect(pkt.ITID).toBe(1201);
	});

	it('reads a long item id from 20181121', () => {
		PACKETVER.value = 20211103;
		const pkt = parse([...RESULT, 0xa0, 0x86, 0x01, 0x00]);

		expect(pkt.msg).toBe(3);
		expect(pkt.ITID).toBe(100000);
	});
});
