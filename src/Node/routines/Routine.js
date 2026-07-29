/**
 * Node/routines/Routine.js
 *
 * Base interface for an auto-pilot routine. A routine consumes the RoClient
 * façade (never raw packets), arms timers/listeners in start(), and must fully
 * disarm them in stop(). onReconnect() is called by ClientSession after the
 * handshake is replayed, so the routine can re-evaluate against fresh state.
 */
export class Routine {
	/** @param {string} name registry key / log tag */
	constructor(name) {
		this.name = name;
	}

	/**
	 * @param {import('../api/RoClient.js').RoClient} _client
	 * @param {string[]} _args
	 * @param {object} _ctx { session, client, config, log }
	 */
	start(_client, _args, _ctx) {
		throw new Error(this.name + '.start() not implemented');
	}

	stop() {}

	onReconnect() {}
}
