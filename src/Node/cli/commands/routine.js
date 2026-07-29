/**
 * /routine [list|stop [name]] — control running routines.
 */
import { log } from '../../log.js';

export default {
	name: 'routine',
	aliases: ['r'],
	usage: '[list|stop [name]]',
	help: 'list or stop running routines',
	run(ctx, args) {
		const sub = args[0];
		if (sub === 'stop') {
			const name = args[1] || 'autobuff';
			const ok = ctx.session.stopRoutine(name);
			log.event(ok ? 'stopped routine "' + name + '"' : 'no active routine "' + name + '"');
			return;
		}
		const active = ctx.session.listRoutines();
		log.event(active.length ? 'active routines: ' + active.join(', ') : 'no active routine');
	}
};
