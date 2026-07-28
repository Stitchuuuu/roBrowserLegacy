/**
 * Node/api/PartyMember.js
 *
 * Read view over a single roster entry. `getStatus()` reaches into the
 * shared StatusState (via the parent Party) for this member's EFST.
 * on('hp'|'status') subscribes to the party-wide stream filtered to this
 * member's AID.
 */
export class PartyMember {
	constructor(raw, party) {
		this._raw = raw;
		this._party = party;
	}

	get aid() {
		return this._raw.aid;
	}
	get gid() {
		return this._raw.gid;
	}
	get name() {
		return this._raw.name;
	}
	get map() {
		return this._raw.map;
	}
	get role() {
		return this._raw.role;
	}
	get online() {
		return this._raw.online;
	}
	get baseLevel() {
		return this._raw.baseLevel;
	}
	get hp() {
		return this._raw.hp;
	}
	get maxhp() {
		return this._raw.maxhp;
	}
	get x() {
		return this._raw.x;
	}
	get y() {
		return this._raw.y;
	}

	/**
	 * @param {number} [efst] omit for the whole per-AID EFST bucket
	 */
	getStatus(efst) {
		return this._party.getStatusState().get(this.aid, efst);
	}

	hasStatus(efst) {
		return this._party.getStatusState().has(this.aid, efst);
	}

	// 'hp' | 'status' — the underlying streams carry every member; filter to us.
	on(event, cb) {
		const aid = this.aid;
		this._party.on(event, payload => {
			if (payload && payload.aid === aid) {
				cb(payload);
			}
		});
		return this;
	}
}
