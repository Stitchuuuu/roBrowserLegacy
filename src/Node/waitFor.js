/**
 * Node/waitFor.js
 *
 * Async primitive: resolve once `event` fires on `emitter` with a payload that
 * satisfies `predicate`. Every exit path (resolve / timeout / abort) removes
 * the listener and clears the timer — this client runs unattended for long
 * stretches, so a leaked listener or timer per call is a slow leak.
 *
 * It only sees *future* firings — a caller wanting "already true, or next time"
 * checks the synchronous tracker state first and calls waitFor only if not yet
 * satisfied (single-threaded JS, no race). No polling mode: the codebase is
 * event-driven (see routines/Routine.js).
 *
 * `opts.signal` (AbortSignal) is honoured but never *created* here — session 3
 * owns instant-abort; this only has to not preclude a signal handed in later.
 */

/**
 * @param {import('node:events').EventEmitter} emitter any tracker / façade / RoClient
 * @param {string} event event name to wait on
 * @param {function(*): boolean} [predicate] accept the payload (default: any firing)
 * @param {{timeout?: number, signal?: AbortSignal}} [opts] timeout ms (default 10000), abort signal
 * @returns {Promise<*>} resolves with the accepted payload
 */
export function waitFor(emitter, event, predicate = () => true, opts = {}) {
	const timeout = opts.timeout != null ? opts.timeout : 10000;
	const signal = opts.signal;

	return new Promise((resolve, reject) => {
		// Already aborted → reject without ever subscribing.
		if (signal && signal.aborted) {
			reject(new Error('waitFor aborted'));
			return;
		}

		let timer = null;
		const cleanup = () => {
			emitter.off(event, onEvent);
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
		};
		const onEvent = payload => {
			let ok;
			try {
				ok = predicate(payload);
			} catch (err) {
				cleanup();
				reject(err);
				return;
			}
			if (ok) {
				cleanup();
				resolve(payload);
			}
		};
		const onAbort = () => {
			cleanup();
			reject(new Error('waitFor aborted'));
		};

		timer = setTimeout(() => {
			cleanup();
			reject(new Error('waitFor timed out after ' + timeout + 'ms waiting for "' + event + '"'));
		}, timeout);

		emitter.on(event, onEvent);
		if (signal) {
			signal.addEventListener('abort', onAbort);
		}
	});
}
