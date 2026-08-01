/**
 * /stop [macro] — abort the macro started by /run.
 *
 * The abort travels through the AbortSignal the loader handed to the bot, so
 * every in-flight waitFor / sleep rejects at once — the macro stops mid-action,
 * not at the next action boundary. The optional name is a guard against a typo,
 * not a selector: only one macro ever runs.
 *
 * Only the macro is stopped — routines armed by /autobuff, /autoheal, /homunbuff
 * or /macro keep running (/routine stop and /macro off own those).
 */
import { stop, runningMacro } from '../../macro/loader.js';
import { log } from '../../log.js';

export default {
	name: 'stop',
	usage: '[macro]',
	help: 'abort the running macro (see /run)',
	run(ctx, args) {
		const running = runningMacro();
		if (!running) {
			log.event('no macro running');
			return;
		}
		if (args[0] && args[0] !== running) {
			log.event('macro "' + running + '" is running, not "' + args[0] + '"');
			return;
		}
		stop(); // the loader logs 'macro "<name>" stopped' once it unwinds
	}
};
