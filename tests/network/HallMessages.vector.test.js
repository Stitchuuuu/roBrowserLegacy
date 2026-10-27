/**
 * tests/network/HallMessages.vector.test.js
 *
 * The hall's messages are pinned by one vector shared with roBrowserLegacy-Node (src/Node/spectate/hall-messages.js):
 * the same messages give the same text on both sides, and both refuse, or ignore, the same texts.
 */
import { describe, expect, it } from 'vitest';
import { VERSION, MAX_TEXT, MAX_CHARS, encode, parse } from 'Network/HallMessages.js';
import vector from '../fixtures/hall-vector.json';

describe('hall message vector', () => {
	it('names the same version and limits', () => {
		expect(vector.version).toBe(VERSION);
		expect(vector.maxText).toBe(MAX_TEXT);
		expect(vector.maxChars).toBe(MAX_CHARS);
	});

	it.each(vector.encode.map(c => [c.name, c]))('encodes and parses %s', (_name, c) => {
		expect(encode(c.msg)).toBe(c.text);
		expect(parse(c.text)).toEqual(c.msg);
	});

	it.each(vector.parse.map(c => [c.name, c]))('parses %s', (_name, c) => {
		expect(parse(c.text)).toEqual(c.msg);
	});

	it.each(vector.ignored.map(c => [c.name, c]))('ignores %s', (_name, c) => {
		expect(parse(c.text)).toBe(null);
	});

	it.each(vector.bad.map(c => [c.name, c]))('refuses %s', (_name, c) => {
		expect(() => parse(c.text)).toThrow(/hall message/);
	});

	it('refuses what is not text', () => {
		expect(() => parse(Uint8Array.of(123, 125))).toThrow(/not text/);
	});
});
