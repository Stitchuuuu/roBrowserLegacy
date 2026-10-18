// Access key of a keyed build (encrypt.mjs): the build ships Online.js.enc + keyslots.json instead of
// Online.js. Each slot holds the content key, wrapped with a key derived from one access key; the first
// slot that opens with the player's key gives the content key. Used by index.html (asks the key) and
// gate.js (decrypts the client). The key is kept in localStorage, shared by every keyed site of the origin.
window.roAccessKey = (() => {
	const STORE = 'roAccessKey';
	const INFO = new TextEncoder().encode('roBrowser access key');
	const { subtle } = crypto;

	const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

	// 32 hex digits, dashes and case ignored; null when it is not one.
	function parse(text) {
		const hex = String(text).toLowerCase().replace(/[\s-]/g, '');
		return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
	}

	// The slots of this build, or null for a build without key (no keyslots.json).
	async function slots() {
		const res = await fetch('keyslots.json', { cache: 'no-cache' });
		if (res.status === 404) {
			return null;
		}
		if (!res.ok) {
			throw new Error(`keyslots.json: HTTP ${res.status}`);
		}
		return (await res.json()).slots;
	}

	// The content key the access key opens, or null.
	async function open(hex, list) {
		const bytes = Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
		const ikm = await subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
		for (const slot of list) {
			const wrap = await subtle.deriveKey(
				{ name: 'HKDF', hash: 'SHA-256', salt: fromBase64(slot.salt), info: INFO },
				ikm,
				{ name: 'AES-GCM', length: 256 },
				false,
				['decrypt']
			);
			let raw;
			try {
				raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(slot.iv) }, wrap, fromBase64(slot.key));
			} catch {
				continue;
			}
			return subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
		}
		return null;
	}

	// Online.js.enc (iv ‖ ciphertext) → the source text.
	async function decrypt(key, enc) {
		const bytes = new Uint8Array(enc);
		const plain = await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
		return new TextDecoder().decode(plain);
	}

	// localStorage can throw (blocked site data); no stored key then.
	function stored() {
		try {
			return localStorage.getItem(STORE);
		} catch {
			return null;
		}
	}

	function save(hex) {
		try {
			localStorage.setItem(STORE, hex);
		} catch {
			// asked again next time
		}
	}

	function forget() {
		try {
			localStorage.removeItem(STORE);
		} catch {
			// nothing stored
		}
	}

	return { parse, slots, open, decrypt, stored, save, forget };
})();
