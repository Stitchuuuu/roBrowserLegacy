/**
 * /emote <name> — play an emotion (token, e.g. thx, no1, heh).
 */
import { log } from '../../log.js';

export default {
	name: 'emote',
	aliases: ['e', 'em'],
	usage: '<name>',
	help: 'play an emotion',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /emote <name>  (e.g. thx, no1, heh)');
			return;
		}
		const res = ctx.client.emote(args[0]);
		if (!res || !res.sent) {
			log.event('emote failed: ' + (res && res.reason));
		}
	}
};
