/**
 * tests/network/NetworkManager.handlerThrow.test.js
 *
 * A packet handler that throws must not hold back the packets received after
 * it. They are already in the buffer: left there, they are only parsed when
 * the server sends something else - on a quiet map, the next ZC_NOTIFY_TIME,
 * ten seconds later.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('UI/UIManager.js', () => ({ default: { showErrorBox: vi.fn() } }));

let Network;
let PACKET;

/**
 * Two ZC_NOTIFY_TIME (0x7f, 6 bytes) back to back, as one socket message
 */
function twoNotifyTime() {
	const bytes = new Uint8Array(12);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0x7f, true);
	view.setUint32(2, 1000, true);
	view.setUint16(6, 0x7f, true);
	view.setUint32(8, 2000, true);
	return bytes.buffer;
}

describe('a packet handler that throws', () => {
	beforeEach(async () => {
		vi.resetModules();
		Network = (await import('Network/NetworkManager.js')).default;
		PACKET = (await import('Network/PacketStructure.js')).default;
		(await import('Network/PacketLength.js')).default.init(20211103);
	});

	it('still lets the next packet of the same message through', () => {
		let socket;
		Network.setSocketFactory(() => (socket = { connected: true, close: vi.fn(), send: vi.fn() }));
		Network.connect('zone', 1, () => {});
		socket.onComplete(true);

		const seen = [];
		Network.hookPacket(PACKET.ZC.NOTIFY_TIME, pkt => {
			seen.push(pkt.time);
			if (pkt.time === 1000) {
				throw new Error('handler bug');
			}
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		socket.onMessage(twoNotifyTime());

		expect(seen).toEqual([1000, 2000]);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
