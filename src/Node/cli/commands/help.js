/**
 * /help — list the available slash-commands.
 */
import { log } from '../../log.js';

export default {
	name: 'help',
	aliases: ['h', '?'],
	help: 'list commands',
	run(ctx) {
		log.event('commands:');
		const cmds = ctx.commandList();
		for (let i = 0, n = cmds.length; i < n; ++i) {
			const c = cmds[i];
			log.event('  /' + c.name + (c.usage ? ' ' + c.usage : '') + ' — ' + c.help);
		}
	}
};
