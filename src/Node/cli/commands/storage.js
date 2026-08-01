/**
 * /storage deposit <index|name> [count] | withdraw <index|name> [count] | close
 * — move items between inventory and an open kafra storage.
 */
import { log } from '../../log.js';

// A numeric token is a slot index; anything else is a (best-effort) name.
function asTarget(token) {
	const n = Number(token);
	return Number.isNaN(n) ? token : n;
}

function report(action, res) {
	if (res && res.sent) {
		log.event('storage ' + action + (res.index != null ? ' slot ' + res.index + ' ×' + res.count : ''));
	} else {
		log.event('storage ' + action + ' refused: ' + (res && res.reason));
	}
}

export default {
	name: 'storage',
	usage: 'deposit <index|name> [count] | withdraw <index|name> [count] | close',
	help: 'move items between inventory and open storage',
	run(ctx, args) {
		const storage = ctx.client.storage;
		const sub = args[0];
		switch (sub) {
			case 'deposit': {
				if (args.length < 2) {
					log.event('usage: /storage deposit <index|name> [count]');
					return;
				}
				const count = args[2] != null ? Number(args[2]) : undefined;
				report('deposit', storage.deposit(asTarget(args[1]), count));
				return;
			}
			case 'withdraw': {
				if (args.length < 2) {
					log.event('usage: /storage withdraw <index|name> [count]');
					return;
				}
				const count = args[2] != null ? Number(args[2]) : undefined;
				report('withdraw', storage.withdraw(asTarget(args[1]), count));
				return;
			}
			case 'close':
				report('close', storage.close());
				return;
			default:
				log.event('usage: /storage deposit <index|name> [count] | withdraw <index|name> [count] | close');
		}
	}
};
