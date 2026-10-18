#!/usr/bin/env node
// Locks a keyed build (BUILDS, access `key`): encrypts the site's Online.js with a fresh content key
// (AES-GCM) into Online.js.enc, writes one key slot per access key into keyslots.json, removes Online.js.
// A slot is the content key wrapped with a key derived from the access key (HKDF-SHA-256): it opens only
// with that access key, so keyslots.json is public. A new content key on every run makes the slot of a
// removed access key useless. shared/access-key.js is the browser side.
//   NPM_ACCESS_KEYS='<label> <key>' (one per line) node encrypt.mjs <site-dir>
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = globalThis.crypto;
const INFO = new TextEncoder().encode('roBrowser access key');

const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const base64 = bytes => Buffer.from(bytes).toString('base64');

/** An access key: 32 hex digits, dashes and case ignored. @param {string} text @returns {string|null} */
export function parseKey(text) {
	const hex = String(text).toLowerCase().replace(/[\s-]/g, '');
	return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/** `<label> <key>` lines; blank lines and `#` comments skipped. @param {string} text */
export function parseKeys(text) {
	const keys = [];
	for (const line of String(text).split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const hex = parseKey(trimmed.split(/\s+/).pop());
		if (!hex) {
			throw new Error(`not "<label> <key>": ${trimmed.split(/\s+/)[0]} …`);
		}
		keys.push(hex);
	}
	if (!keys.length) {
		throw new Error('no access key');
	}
	return keys;
}

async function wrapKey(hex, salt) {
	const ikm = await subtle.importKey('raw', Buffer.from(hex, 'hex'), 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
		ikm,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	);
}

/**
 * @param {Uint8Array} source - Online.js
 * @param {string[]} keys - access keys, as parseKey returns them
 * @returns {Promise<{ enc: Uint8Array, slots: { salt: string, iv: string, key: string }[] }>} enc = iv ‖ ciphertext
 */
export async function lock(source, keys) {
	const raw = random(32);
	const content = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
	const iv = random(12);
	const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, content, source));
	const enc = new Uint8Array(iv.length + cipher.length);
	enc.set(iv);
	enc.set(cipher, iv.length);

	const slots = [];
	for (const hex of keys) {
		const salt = random(16);
		const slotIv = random(12);
		const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv: slotIv }, await wrapKey(hex, salt), raw);
		slots.push({ salt: base64(salt), iv: base64(slotIv), key: base64(new Uint8Array(wrapped)) });
	}
	return { enc, slots };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const site = process.argv[2];
	if (!site) {
		console.error('usage: NPM_ACCESS_KEYS=… node encrypt.mjs <site-dir>');
		process.exit(2);
	}
	let keys;
	try {
		keys = parseKeys(process.env.NPM_ACCESS_KEYS || '');
	} catch (err) {
		console.error(`NPM_ACCESS_KEYS: ${err.message} — set the secret (wtf pages key new <label>)`);
		process.exit(1);
	}
	const { enc, slots } = await lock(await readFile(join(site, 'Online.js')), keys);
	await writeFile(join(site, 'Online.js.enc'), enc);
	await writeFile(join(site, 'keyslots.json'), JSON.stringify({ slots }) + '\n');
	await rm(join(site, 'Online.js'));
	console.log(`${site}: Online.js locked, ${slots.length} key slot(s)`);
}
