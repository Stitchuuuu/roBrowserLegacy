// encrypt.mjs locks, shared/access-key.js (the browser side, run in a vm) opens.
//   node --test .github/pages-sites/access-key.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { lock, parseKey, parseKeys } from './encrypt.mjs';

const HERE = new URL('.', import.meta.url);
const { roAccessKey } = runInNewContext(
	`${readFileSync(new URL('shared/access-key.js', HERE), 'utf8')}; ({ roAccessKey: window.roAccessKey })`,
	{ window: {}, crypto: globalThis.crypto, atob, TextEncoder, TextDecoder, Uint8Array }
);

const KEYS = [
	'0123-4567-89ab-cdef-0123-4567-89ab-cdef',
	'ffffffffffffffffffffffffffffffff',
	'A1B2-C3D4-E5F6-A7B8-C9D0-E1F2-A3B4-C5D6'
];
const SOURCE = new TextEncoder().encode('console.log(new URL("ThreadEventHandler.js", import.meta.url));');

async function opens(key, slots, enc) {
	const content = await roAccessKey.open(roAccessKey.parse(key), slots);
	return content && (await roAccessKey.decrypt(content, enc));
}

test('a key is 32 hex digits, dashes and case ignored', () => {
	assert.equal(parseKey(KEYS[2]), 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
	assert.equal(roAccessKey.parse(KEYS[2]), parseKey(KEYS[2]));
	assert.equal(roAccessKey.parse('0123'), null);
	assert.equal(roAccessKey.parse('g'.repeat(32)), null);
});

test('the secret is <label> <key> lines', () => {
	assert.deepEqual(parseKeys(`# testers\nalice ${KEYS[0]}\n\nbob ${KEYS[1]}\n`), [
		parseKey(KEYS[0]),
		parseKey(KEYS[1])
	]);
	assert.throws(() => parseKeys('alice not-a-key'), /alice/);
	assert.throws(() => parseKeys('# nothing\n'), /no access key/);
});

test('3 keys: 3 slots, each key opens, a 4th key does not', async () => {
	const { enc, slots } = await lock(SOURCE, KEYS.map(parseKey));
	assert.equal(slots.length, 3);
	for (const key of KEYS) {
		assert.equal(await opens(key, slots, enc), new TextDecoder().decode(SOURCE));
	}
	const random = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
	assert.equal(await opens(random, slots, enc), null);
});

test('a key removed from the secret does not open the next deploy', async () => {
	const { slots } = await lock(SOURCE, [parseKey(KEYS[0]), parseKey(KEYS[2])]);
	assert.equal(await roAccessKey.open(parseKey(KEYS[1]), slots), null);
	assert.ok(await roAccessKey.open(parseKey(KEYS[0]), slots));
});

test('the CLI locks a site folder, and a redeploy changes Online.js.enc', () => {
	const site = mkdtempSync(join(tmpdir(), 'access-key-'));
	const env = { ...process.env, NPM_ACCESS_KEYS: KEYS.map((k, i) => `tester${i} ${k}`).join('\n') };
	const run = () => {
		writeFileSync(join(site, 'Online.js'), SOURCE);
		execFileSync(process.execPath, [new URL('encrypt.mjs', HERE).pathname, site], { env });
		return readFileSync(join(site, 'Online.js.enc'));
	};
	const first = run();
	assert.equal(existsSync(join(site, 'Online.js')), false);
	assert.equal(JSON.parse(readFileSync(join(site, 'keyslots.json'), 'utf8')).slots.length, 3);
	assert.notDeepEqual(run(), first);
});

test('the CLI refuses to deploy without keys', () => {
	const site = mkdtempSync(join(tmpdir(), 'access-key-'));
	writeFileSync(join(site, 'Online.js'), SOURCE);
	assert.throws(
		() =>
			execFileSync(process.execPath, [new URL('encrypt.mjs', HERE).pathname, site], {
				env: { ...process.env, NPM_ACCESS_KEYS: '' },
				stdio: 'pipe'
			}),
		/NPM_ACCESS_KEYS/
	);
	assert.ok(existsSync(join(site, 'Online.js')));
});
