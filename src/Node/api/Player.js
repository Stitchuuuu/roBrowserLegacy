/**
 * Node/api/Player.js
 *
 * Friendly read view over PlayerState. Getters read live tracker fields;
 * on()/off() forward to the tracker's EventEmitter ('hp' | 'sp' | 'change').
 */
export class Player {
	constructor(state) {
		this._s = state;
	}

	get hp() {
		return this._s.hp;
	}
	get maxhp() {
		return this._s.maxhp;
	}
	get sp() {
		return this._s.sp;
	}
	get maxsp() {
		return this._s.maxsp;
	}
	get zeny() {
		return this._s.zeny;
	}
	get weight() {
		return this._s.weight;
	}
	get maxweight() {
		return this._s.maxweight;
	}
	get stats() {
		return this._s.stats;
	}

	on(event, cb) {
		this._s.on(event, cb);
		return this;
	}
	off(event, cb) {
		this._s.off(event, cb);
		return this;
	}
}
