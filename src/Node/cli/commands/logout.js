/**
 * /logout — voluntary disconnect (stops routines, no auto-reconnect).
 */
import { log } from '../../log.js';

export default {
	name: 'logout',
	help: 'disconnect without auto-reconnect (/login to return)',
	run(ctx) {
		ctx.session.logout();
		log.event('logged out — /login to reconnect');
	}
};
