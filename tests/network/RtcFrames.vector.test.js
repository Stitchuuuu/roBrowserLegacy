/**
 * tests/network/RtcFrames.vector.test.js
 *
 * The record format is pinned by one vector shared with roBrowserLegacy-Node (src/Node/spectate/rtc-frames.js): the same
 * records give the same bytes on both sides, and the Outbox cuts a stream into
 * the same messages, up to the 1 MiB edge.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OPEN, DATA, CLOSE, MAX_MESSAGE, encode, decode, Outbox } from 'Network/SocketHelpers/RtcFrames.js';
import vector from '../fixtures/rtc-frames-vector.json';

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('record format vector', () => {
	it('names the same types and cap', () => {
		expect(vector.types).toEqual({ OPEN, DATA, CLOSE });
		expect(vector.maxMessage).toBe(MAX_MESSAGE);
	});

	it.each(vector.encode.map(c => [c.name, c]))('encodes and decodes %s', (_name, c) => {
		const records = c.records.map(r => ({ type: r.type, sid: r.sid, bytes: r.len ? bytes(r.len, r.seed) : null }));
		const msg = encode(records);

		expect(hex(msg)).toBe(c.hex);
		expect(decode(msg).map(r => [r.type, r.sid, hex(r.bytes)])).toEqual(
			records.map(r => [r.type, r.sid, r.bytes ? hex(r.bytes) : ''])
		);
	});

	it.each(vector.outbox.map(c => [c.name, c]))('Outbox: %s', async (_name, c) => {
		const sent = [];
		const out = new Outbox(msg => {
			sent.push(msg);
			return Promise.resolve();
		});
		for (let i = 0; i < c.writes.length; ++i) {
			const w = c.writes[i];
			out.write(w.type, w.sid, w.len ? bytes(w.len, w.seed) : undefined);
		}
		for (let i = 0; i < 5; ++i) {
			await settle();
		}

		expect(
			sent.map(m => ({
				size: m.length,
				sha256: createHash('sha256').update(m).digest('hex'),
				records: decode(m).map(r => [r.type, r.sid, r.bytes.length])
			}))
		).toEqual(c.messages);
	});
});
