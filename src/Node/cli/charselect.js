/**
 * Node/cli/charselect.js
 *
 * Interactive character picker used at char-list time (inline first-run setup
 * and /login). Shows the real server list (name / slot / level / job) as a
 * numbered menu and returns the chosen CharNum (slot). Reuses config.js's
 * raw-mode prompt. Defaults to the last-used slot so a plain Enter re-picks it.
 */
import process from 'node:process';
import { rawPrompt } from '../config.js';

function field(c, ...names) {
	for (let i = 0; i < names.length; ++i) {
		if (c[names[i]] != null) {
			return c[names[i]];
		}
	}
	return null;
}

/**
 * @param {Array} charList deduped character list (each has name, CharNum, …)
 * @param {{defaultSlot?: number}} [opts]
 * @returns {Promise<number>} chosen CharNum
 */
export async function selectCharacter(charList, opts = {}) {
	const out = process.stdout;

	// Non-interactive: fall back to the default slot (or the first character).
	// Warn — an intended-interactive pick that silently fell back here is the
	// "I switched account but got no prompt" surprise.
	if (!process.stdin.isTTY) {
		const fallback = charList.find(c => c.CharNum === opts.defaultSlot);
		const chosen = (fallback || charList[0]).CharNum;
		out.write('no TTY — auto-selecting character slot ' + chosen + ' (pass --char to choose)\n');
		return chosen;
	}

	let defaultIdx = 0;
	out.write('\nCharacters on this account:\n');
	for (let i = 0; i < charList.length; ++i) {
		const c = charList[i];
		if (c.CharNum === opts.defaultSlot) {
			defaultIdx = i;
		}
		const lvl = field(c, 'BaseLevel', 'Level', 'level');
		const job = field(c, 'Job', 'job', 'jobId', 'Class');
		out.write(
			'  ' +
				(i + 1) +
				') ' +
				(c.name || '(no name)') +
				'  · slot ' +
				c.CharNum +
				(lvl != null ? '  · Lv ' + lvl : '') +
				(job != null ? '  · job ' + job : '') +
				'\n'
		);
	}

	for (;;) {
		const r = await rawPrompt('Select character [' + (defaultIdx + 1) + ']: ');
		if (r.eof || r.interrupted) {
			throw new Error('character selection aborted');
		}
		const v = (r.value || '').trim();
		const idx = v === '' ? defaultIdx : parseInt(v, 10) - 1;
		if (idx >= 0 && idx < charList.length) {
			return charList[idx].CharNum;
		}
		out.write('(invalid — enter 1..' + charList.length + ')\n');
	}
}
