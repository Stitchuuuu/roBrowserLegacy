import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeValue, dumpStorage, encodeValue, load, loadStorage } from '../../plugins/local-plugin-manager/backup.js';

// Values exactly as the engine and plugins leave them: odd spacing, a stale
// `_version`, raw scalars, a key literally named "undefined".
const RAW = {
	WinStats: '{"x":10,"y":20,"show":true,"_version":1}',
	Graphics: '{ "_version" : 0,  "fps":60 ,"quality": "high"}',
	WinLogin: '{"saveID":true,"ID":"plantfarm","_version":1}',
	HOM_AGGRESSIVE: '1',
	MER_AGGRESSIVE: '0',
	PartyFriends_PlantTester_Detached: '{"2000001":{"x":5,"y":7}}',
	'RespawnRadar.settings': '{\n\t"radius": 14\n}',
	undefined: '{"_version":1,"a":[]}',
	empty: '',
};

function fill() {
	for (const key in RAW) {
		localStorage.setItem(key, RAW[key]);
	}
}

describe('backup — localStorage half', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('round-trips every raw string byte for byte', () => {
		fill();
		const dumped = dumpStorage(localStorage);
		localStorage.clear();
		const count = loadStorage(localStorage, JSON.parse(JSON.stringify(dumped)));

		expect(count).toBe(Object.keys(RAW).length);
		expect(localStorage.length).toBe(Object.keys(RAW).length);
		for (const key in RAW) {
			expect(localStorage.getItem(key)).toBe(RAW[key]);
		}
	});

	it('keeps WinLogin by default and drops it on request', () => {
		fill();
		expect(dumpStorage(localStorage).WinLogin).toBe(RAW.WinLogin);

		const noLogin = dumpStorage(localStorage, { excludeWinLogin: true });
		expect('WinLogin' in noLogin).toBe(false);
		expect(Object.keys(noLogin).length).toBe(Object.keys(RAW).length - 1);
	});

	it('refuses a file of another format or version and writes nothing', async () => {
		const entries = { localStorage: { injected: 'x' }, indexedDB: [] };

		await expect(load(JSON.stringify({ format: 'nope', version: 1, ...entries }))).rejects.toThrow();
		await expect(load({ format: 'ro-backup', version: 2, ...entries })).rejects.toThrow();
		await expect(load('null')).rejects.toThrow();
		await expect(load({ format: 'ro-backup', version: 1, localStorage: { injected: 'x' } })).rejects.toThrow();
		expect(localStorage.getItem('injected')).toBe(null);
	});
});

// Through JSON, as the file does.
const roundTrip = async v => decodeValue(JSON.parse(JSON.stringify(await encodeValue(v))));

describe('backup — IndexedDB value codec', () => {
	it('round-trips plain records, holes and non-finite numbers', async () => {
		const record = { name: 'hello', enabled: true, version: '1.0.0', source: 'export default {}\n', n: 0, list: [1, 'a', null, { deep: [true] }] };
		expect(await roundTrip(record)).toEqual(record);

		const odd = await roundTrip({ u: undefined, nan: NaN, inf: -Infinity, arr: [undefined, 1] });
		expect('u' in odd).toBe(true);
		expect(odd.u).toBeUndefined();
		expect(Number.isNaN(odd.nan)).toBe(true);
		expect(odd.inf).toBe(-Infinity);
		expect(odd.arr).toEqual([undefined, 1]);
	});

	it('round-trips binary values byte for byte, keeping their type', async () => {
		const bytes = new Uint8Array(70000);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = (i * 7) & 0xff;
		}

		const blob = await roundTrip(new Blob([bytes], { type: 'text/x-lua' }));
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('text/x-lua');
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);

		const file = await roundTrip(new File([bytes], 'AI.lua', { type: 'text/plain', lastModified: 1700000000000 }));
		expect(file).toBeInstanceOf(File);
		expect([file.name, file.type, file.lastModified]).toEqual(['AI.lua', 'text/plain', 1700000000000]);
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

		const u8 = await roundTrip(bytes.subarray(10, 20));
		expect(u8).toBeInstanceOf(Uint8Array);
		expect(Array.from(u8)).toEqual(Array.from(bytes.subarray(10, 20)));

		const f32 = await roundTrip(new Float32Array([1.5, -2]));
		expect(f32).toBeInstanceOf(Float32Array);
		expect(Array.from(f32)).toEqual([1.5, -2]);

		const ab = await roundTrip(bytes.slice(0, 4).buffer);
		expect(ab).toBeInstanceOf(ArrayBuffer);
		expect(Array.from(new Uint8Array(ab))).toEqual(Array.from(bytes.slice(0, 4)));

		const date = await roundTrip(new Date(1700000000123));
		expect(date).toBeInstanceOf(Date);
		expect(date.getTime()).toBe(1700000000123);
	});

	it('refuses what it cannot carry instead of losing it', async () => {
		await expect(encodeValue(new Map([['a', 1]]))).rejects.toThrow(/Map/);
		await expect(encodeValue({ nested: new Set([1]) })).rejects.toThrow(/Set/);
		await expect(encodeValue({ $ro: 'blob' })).rejects.toThrow(/\$ro/);
		await expect(encodeValue(10n)).rejects.toThrow(/bigint/);
		expect(() => decodeValue({ $ro: 'nope' })).toThrow();
	});
});

describe('tools/roexport.js', () => {
	// The page script cannot import backup.js, so it carries a copy: any drift
	// between the two would make a dump from one side unreadable by the other.
	it('carries the shared functions of backup.js verbatim', () => {
		const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
		const backup = read('../../plugins/local-plugin-manager/backup.js');
		const page = read('../../tools/roexport.js');

		const shared = backup
			.slice(backup.indexOf("const FORMAT = 'ro-backup';"), backup.indexOf('export { encodeValue'))
			.replace(/^export function/gm, 'function');
		const copy = page
			.slice(page.indexOf("\tconst FORMAT = 'ro-backup';"), page.indexOf('\t// Clipboard writes'))
			.replace(/^\t/gm, '');

		expect(shared.length).toBeGreaterThan(1000);
		expect(copy.trimEnd()).toBe(shared.trimEnd());
	});
});
