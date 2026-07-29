/**
 * Node/routines/registry.js
 *
 * Routine name → class map, and a factory used by ClientSession.startRoutine
 * and the index.js direct-launch dispatch.
 */
import { AutoBuff } from './AutoBuff.js';
import { AutoHeal } from './AutoHeal.js';
import { HomunBuff } from './HomunBuff.js';

const REGISTRY = {
	autobuff: AutoBuff,
	autoheal: AutoHeal,
	homunbuff: HomunBuff
};

/**
 * @param {string} name
 * @returns {?import('./Routine.js').Routine} a fresh instance, or null if unknown
 */
export function createRoutine(name) {
	const RoutineClass = REGISTRY[String(name).toLowerCase()];
	return RoutineClass ? new RoutineClass() : null;
}

export function routineNames() {
	return Object.keys(REGISTRY);
}
