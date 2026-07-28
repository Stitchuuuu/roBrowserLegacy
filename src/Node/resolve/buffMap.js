/**
 * Node/resolve/buffMap.js
 *
 * SKID → granted EFST (status-effect id). There is no single native table
 * linking a skill to the status it grants, so this is a small hand map for
 * the town-buff scope. Extend as routines cover more buffs.
 *
 * Keyed/valued through SkillConst / StatusConst by name for readability —
 * both are pure enum leaves (name → id).
 */
import SkillConst from 'DB/Skills/SkillConst.js';
import StatusConst from 'DB/Status/StatusConst.js';

const MAP = {
	[SkillConst.SM_PROVOKE]: StatusConst.PROVOKE, // 6 → 0
	[SkillConst.AL_ANGELUS]: StatusConst.ANGELUS, // 33 → 9
	[SkillConst.AL_BLESSING]: StatusConst.BLESSING, // 34 → 10
	[SkillConst.AL_INCAGI]: StatusConst.INC_AGI, // 29 → 12
	[SkillConst.PR_IMPOSITIO]: StatusConst.IMPOSITIO, // 66 → 15
	[SkillConst.PR_SUFFRAGIUM]: StatusConst.SUFFRAGIUM, // 67 → 16
	[SkillConst.PR_ASPERSIO]: StatusConst.ASPERSIO, // 68 → 17
	[SkillConst.PR_KYRIE]: StatusConst.KYRIE, // 73 → 19
	[SkillConst.PR_MAGNIFICAT]: StatusConst.MAGNIFICAT, // 74 → 20
	[SkillConst.PR_GLORIA]: StatusConst.GLORIA // 75 → 21
};

/**
 * @param {number} skid
 * @returns {?number} EFST id the skill grants, or null if unmapped
 */
export function buffEfst(skid) {
	const efst = MAP[skid];
	return efst == null ? null : efst;
}
