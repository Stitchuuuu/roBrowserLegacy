/**
 * /whisper <name> <msg> — private message.
 */
import { log } from '../../log.js';

export default {
	name: 'whisper',
	aliases: ['w', 'pm'],
	usage: '<name> <msg>',
	help: 'send a private message',
	run(ctx, args) {
		if (args.length < 2) {
			log.event('usage: /whisper <name> <msg>');
			return;
		}
		const name = args[0];
		const text = args.slice(1).join(' ');
		ctx.client.whisper(name, text);
	}
};
