/**
 * Node/resolve/buffMap.js
 *
 * SKID → buff facts: the EFST it grants, and how long it lasts. There is no
 * single native table linking a skill to either, so this is a small hand map
 * for the buff-routine scope. Extend as routines cover more buffs.
 *
 * Keyed/valued through SkillConst / StatusConst by name for readability —
 * both are pure enum leaves (name → id).
 *
 * `duration` is ms, either a constant or a function of the cast level, taken
 * from rAthena db/pre-re/skill_db.yml `Duration1`. Supportive buffs get no
 * stat-based reduction (they are absent from status_get_sc_def's switch), so
 * the value is exact rather than an estimate. It is only needed for targets
 * whose EFST is never broadcast — a homunculus — where a timer is the only
 * available oracle; a routine that can read the real status should ignore it.
 * Entries left `null` are simply not needed yet, not "no duration".
 *
 * ⚠️ Pre-renewal values. A server on renewal, or one that customises
 * skill_db, needs the per-profile `durations` override instead.
 */
import SkillConst from 'DB/Skills/SkillConst.js';
import StatusConst from 'DB/Status/StatusConst.js';

const MAP = {
	[SkillConst.SM_PROVOKE]: { efst: StatusConst.PROVOKE, duration: null }, // 6 → 0
	[SkillConst.AL_ANGELUS]: { efst: StatusConst.ANGELUS, duration: null }, // 33 → 9
	[SkillConst.AL_BLESSING]: { efst: StatusConst.BLESSING, duration: lv => 40000 + 20000 * lv }, // 34 → 10
	[SkillConst.AL_INCAGI]: { efst: StatusConst.INC_AGI, duration: lv => 40000 + 20000 * lv }, // 29 → 12
	[SkillConst.PR_IMPOSITIO]: { efst: StatusConst.IMPOSITIO, duration: 60000 }, // 66 → 15
	[SkillConst.PR_SUFFRAGIUM]: { efst: StatusConst.SUFFRAGIUM, duration: lv => 40000 - 10000 * lv }, // 67 → 16
	[SkillConst.PR_ASPERSIO]: { efst: StatusConst.ASPERSIO, duration: lv => 30000 + 30000 * lv }, // 68 → 17
	[SkillConst.PR_KYRIE]: { efst: StatusConst.KYRIE, duration: 120000 }, // 73 → 19
	[SkillConst.PR_MAGNIFICAT]: { efst: StatusConst.MAGNIFICAT, duration: null }, // 74 → 20
	[SkillConst.PR_GLORIA]: { efst: StatusConst.GLORIA, duration: null } // 75 → 21
};

/**
 * @param {number} skid
 * @returns {?number} EFST id the skill grants, or null if unmapped
 */
export function buffEfst(skid) {
	const entry = MAP[skid];
	return entry ? entry.efst : null;
}

/**
 * @param {number} skid
 * @param {number} level cast level
 * @returns {?number} buff length in ms, or null when unmapped / unknown
 */
export function buffDuration(skid, level) {
	const entry = MAP[skid];
	if (!entry || entry.duration == null) {
		return null;
	}
	return typeof entry.duration === 'function' ? entry.duration(level) : entry.duration;
}
