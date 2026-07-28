/**
 * Node/resolve/skills.js
 *
 * Friendly skill-name → SKID resolution, and SKID → display name (needed
 * because ZC.SKILLINFO_LIST2 — what cyro serves — omits skillName).
 *
 * Accepts, in order: a numeric SKID, a SKID const name (AL_INCAGI), or a
 * friendly alias (increaseagi, bless…). Pure — imports enum leaves only.
 */
import SkillConst from 'DB/Skills/SkillConst.js';
import SkillInfo from 'DB/Skills/SkillInfo.js';

// friendly token (lowercased, stripped of spaces/_/-) → SKID const name
const ALIASES = {
	increaseagi: 'AL_INCAGI',
	incagi: 'AL_INCAGI',
	agiup: 'AL_INCAGI',
	blessing: 'AL_BLESSING',
	bless: 'AL_BLESSING',
	angelus: 'AL_ANGELUS',
	gloria: 'PR_GLORIA',
	magnificat: 'PR_MAGNIFICAT',
	impositio: 'PR_IMPOSITIO',
	suffragium: 'PR_SUFFRAGIUM',
	aspersio: 'PR_ASPERSIO',
	kyrie: 'PR_KYRIE',
	kyrieeleison: 'PR_KYRIE',
	provoke: 'SM_PROVOKE',
	heal: 'AL_HEAL'
};

// reverse SKID id → const name, built once at module load
const idToName = {};
for (const name in SkillConst) {
	idToName[SkillConst[name]] = name;
}

/**
 * Human display name for a SKID. Falls back to the const name, then a
 * synthetic label — never returns undefined.
 *
 * @param {number} skid
 * @returns {string}
 */
export function skillName(skid) {
	const info = SkillInfo[skid];
	if (info && info.SkillName) {
		return info.SkillName;
	}
	return idToName[skid] || 'SKID_' + skid;
}

/**
 * @param {string|number} input alias, SKID const name, or numeric id
 * @returns {?{skid: number, name: string, display: string}}
 */
export function resolveSkill(input) {
	if (input == null || input === '') {
		return null;
	}

	// numeric SKID (number or all-digit string)
	if (typeof input === 'number' || /^\d+$/.test(input)) {
		const id = Number(input);
		const constName = idToName[id];
		return constName ? { skid: id, name: constName, display: skillName(id) } : null;
	}

	const raw = String(input).trim();
	const key = raw.toLowerCase().replace(/[\s_-]/g, '');

	let constName = ALIASES[key];
	if (!constName) {
		const upper = raw.toUpperCase();
		if (SkillConst[upper] != null) {
			constName = upper;
		}
	}
	if (!constName) {
		return null;
	}

	const skid = SkillConst[constName];
	return { skid, name: constName, display: skillName(skid) };
}
