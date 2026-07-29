/**
 * /say <msg> — public chat.
 */
import { log } from '../../log.js';

export default {
	name: 'say',
	usage: '<msg>',
	help: 'public chat',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /say <msg>');
			return;
		}
		ctx.client.say(args.join(' '));
	}
};
