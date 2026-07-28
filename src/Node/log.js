/**
 * Node/log.js
 *
 * Minimal prefixed console logger for the headless Node client.
 */

/**
 * @param {'info'|'warn'|'error'} level
 * @param {...*} args
 */
export function log(level, ...args) {
	const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	fn('[ro-node]', ...args);
}
