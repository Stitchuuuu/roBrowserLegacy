/**
 * Node/secret.js
 *
 * At-rest obfuscation for the account password in RAM. AES-256-GCM with a random
 * per-process key: the password is held encrypted and decrypted only for the
 * moment it's needed (the CA.LOGIN send), so it isn't a long-lived flat string
 * exposed to core dumps / accidental logging / casual memory inspection.
 *
 * NOT a real security boundary: the key lives in the same process, so anyone who
 * can read this process's memory can recover it — this is defense-in-depth
 * obfuscation, not protection against a determined attacker with memory access.
 * JS strings can't be zeroed, so the plaintext exists transiently on get().
 * Never persisted to disk, never logged.
 */
import crypto from 'node:crypto';

export class SecretBox {
	constructor() {
		this._key = crypto.randomBytes(32); // per-process, never leaves RAM
		this._blob = null; // { iv, enc, tag } or null
	}

	/** @param {?string} plaintext store encrypted; null/empty clears */
	set(plaintext) {
		if (plaintext == null || plaintext === '') {
			this._blob = null;
			return;
		}
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
		const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
		this._blob = { iv, enc, tag: cipher.getAuthTag() };
	}

	/** @returns {?string} decrypted plaintext (transient), or null if unset */
	get() {
		if (!this._blob) {
			return null;
		}
		const { iv, enc, tag } = this._blob;
		const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
	}

	has() {
		return !!this._blob;
	}

	clear() {
		this._blob = null;
	}
}
