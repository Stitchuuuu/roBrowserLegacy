/**
 * Node/api/Party.js
 *
 * Roster façade. Members are wrapped fresh on each access (thin views over
 * live PartyState entries). on('hp') forwards party HP updates; on('status')
 * forwards the shared StatusState stream so PartyMember can filter by AID.
 */
import { PartyMember } from './PartyMember.js';

export class Party {
	constructor(state, status) {
		this._state = state;
		this._status = status;
	}

	get name() {
		return this._state.name;
	}

	getStatusState() {
		return this._status;
	}

	getMembers() {
		return this._state.getMembers().map(raw => new PartyMember(raw, this));
	}

	/**
	 * @param {string|number} nameOrAid
	 * @returns {?PartyMember}
	 */
	get(nameOrAid) {
		const raw = typeof nameOrAid === 'number' ? this._state.getByAid(nameOrAid) : this._state.getByName(nameOrAid);
		return raw ? new PartyMember(raw, this) : null;
	}

	on(event, cb) {
		if (event === 'status') {
			this._status.on('status', cb);
		} else {
			this._state.on(event, cb);
		}
		return this;
	}
}
