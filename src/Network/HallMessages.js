/**
 * Network/HallMessages.js
 *
 * Messages of the bots' hall: JSON text between this page and each bot
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 */

/**
 * Message version this page speaks
 * @const {number}
 * @see docs/reference/network/remote-bot.md
 */
export const VERSION = 1;

/**
 * Longest message read, in characters
 * @const {number}
 */
export const MAX_TEXT = 8192;

/**
 * Most characters a bot lists
 * @const {number}
 */
export const MAX_CHARS = 15;

/**
 * Field limits
 * @const {number}
 */
const MAX_NAME = 32;
const MAX_KIND = 16;
const MAX_ROOM = 64;
const MAX_SECRET = 128;
const MAX_ID = 0x7fffffff;

/**
 * @param {string} what
 */
function fail(what) {
	throw new Error(`hall message: ${what}`);
}

/**
 * @param {*} value
 * @param {number} max
 * @param {string} what
 * @return {number}
 */
function int(value, max, what) {
	if (!Number.isInteger(value) || value < 0 || value > max) {
		fail(`${what} is not an integer in 0..${max}`);
	}
	return value;
}

/**
 * @param {*} value
 * @param {number} max
 * @param {string} what
 * @return {string}
 */
function str(value, max, what) {
	if (typeof value !== 'string' || value.length < 1 || value.length > max) {
		fail(`${what} is not a string of 1 to ${max} characters`);
	}
	return value;
}

/**
 * @param {*} c
 * @param {string} what
 * @return {{name: string, job: number, lv: number}}
 */
function char(c, what) {
	if (!c || typeof c !== 'object') {
		fail(`${what} is not an object`);
	}
	return {
		name: str(c.name, MAX_NAME, `${what}.name`),
		job: int(c.job, 9999, `${what}.job`),
		lv: int(c.lv, 999, `${what}.lv`)
	};
}

/**
 * The message with only its known fields, in a fixed order
 *
 * @param {*} m
 * @return {?object} null for an unknown type
 * @see docs/reference/network/remote-bot.md
 */
function normalize(m) {
	if (!m || typeof m !== 'object' || Array.isArray(m)) {
		fail('not an object');
	}

	const t = str(m.t, MAX_KIND, 't');
	const v = int(m.v, 999, 'v');

	if (v < 1) {
		fail('v is below 1');
	}

	switch (t) {
		case 'who':
			return { t, v };

		case 'hello': {
			if (!Array.isArray(m.chars) || m.chars.length > MAX_CHARS) {
				fail(`chars is not an array of at most ${MAX_CHARS}`);
			}
			const chars = m.chars.map((c, i) => char(c, `chars[${i}]`));
			let playing = null;
			if (m.playing !== null) {
				playing = char(m.playing, 'playing');
				playing.map = str(m.playing.map, MAX_NAME, 'playing.map');
			}
			return {
				t,
				v,
				kind: str(m.kind, MAX_KIND, 'kind'),
				account: str(m.account, MAX_NAME, 'account'),
				chars,
				playing,
				windows: int(m.windows, 99, 'windows')
			};
		}

		case 'open':
			return { t, v, id: int(m.id, MAX_ID, 'id') };

		case 'room':
			return {
				t,
				v,
				id: int(m.id, MAX_ID, 'id'),
				room: str(m.room, MAX_ROOM, 'room'),
				secret: str(m.secret, MAX_SECRET, 'secret')
			};

		case 'no':
			return { t, v, id: int(m.id, MAX_ID, 'id'), why: str(m.why, MAX_KIND, 'why') };

		default:
			return null;
	}
}

/**
 * @param {object} m
 * @return {string}
 */
export function encode(m) {
	const n = normalize(m);

	if (!n) {
		fail(`unknown t ${m.t}`);
	}
	return JSON.stringify(n);
}

/**
 * @param {*} data - what a peer sent
 * @return {?object} null for an unknown type; throws on anything else that is no hall message
 */
export function parse(data) {
	let m;

	if (typeof data !== 'string') {
		fail('not text');
	}
	if (data.length > MAX_TEXT) {
		fail(`longer than ${MAX_TEXT}`);
	}
	try {
		m = JSON.parse(data);
	} catch (_e) {
		fail('not JSON');
	}
	return normalize(m);
}
