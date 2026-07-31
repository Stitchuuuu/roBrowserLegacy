/**
 * Node/state/entities.js
 *
 * Generic entity tracker (jalon 1 of node-farm-macros) — same shape as
 * `state/homun.js`, generalised to any `objecttype` on the wire. This session
 * only consumes `TYPE_MOB` (farming targets) and `TYPE_PC` (operator-alert
 * "player crossed the zone"), but the tracker itself is not type-filtered at
 * the packet level — `list()`/`get()`/`count()` take an optional type filter.
 *
 * Only the *11 entry variants are observed: the entry opcodes are a hard
 * function of PACKETVER (rAthena packets_struct.hpp — idle 0x9ff, spawn 0x9fe,
 * walking 0x9fd for PACKETVER >= 20150513), not a per-server choice, so at
 * 20211103 no other variant can arrive. Targeting an older client means adding
 * the matching variants here (see homun.js's own note).
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

const TYPE_PC = 0; // Renderer/Entity/Entity.js — inlined; that module pulls the renderer in
const TYPE_MOB = 5; // ditto

export class EntityState extends EventEmitter {
	constructor() {
		super();
		this.byGid = {}; // gid → { gid, name, x, y, job, objecttype }
	}

	install() {
		observePacket(PACKET.ZC.NOTIFY_STANDENTRY11, pkt => this._onEntry(pkt, pkt.PosDir, 0));
		observePacket(PACKET.ZC.NOTIFY_NEWENTRY11, pkt => this._onEntry(pkt, pkt.PosDir, 0));
		observePacket(PACKET.ZC.NOTIFY_MOVEENTRY11, pkt => this._onEntry(pkt, pkt.MoveData, 2));

		// Position refresh for a unit already in view — doesn't emit (fires on
		// every step of every unit on screen; a routine reads on demand).
		observePacket(PACKET.ZC.NOTIFY_MOVE, pkt => this._move(pkt.GID, pkt.MoveData, 2));
		// STOPMOVE is absolute and authoritative (clif_fixpos); its `AID` field
		// is a block id despite the name, so it keys the same map.
		observePacket(PACKET.ZC.STOPMOVE, pkt => {
			const ent = this.byGid[pkt.AID];
			if (ent) {
				ent.x = pkt.xPos;
				ent.y = pkt.yPos;
			}
		});

		observePacket(PACKET.ZC.NOTIFY_VANISH, pkt => this._vanish(pkt.GID));

		// Map change re-creates every unit with fresh block ids — anything held
		// is a ghost.
		observePacket(PACKET.ZC.NPCACK_MAPMOVE, () => this._clear());
		observePacket(PACKET.ZC.NPCACK_SERVERMOVE, () => this._clear());
		return this;
	}

	// `pos` is readPos() ([x, y, dir]) or readPos2() ([x1, y1, x2, y2, …]);
	// `at` selects which cell pair to read.
	_onEntry(pkt, pos, at) {
		if ((pkt.objecttype !== TYPE_MOB && pkt.objecttype !== TYPE_PC) || !pos) {
			return;
		}
		const gid = pkt.GID;
		const known = this.byGid[gid];
		if (known) {
			// Re-entering view — refresh silently, no spawn event.
			known.x = pos[at];
			known.y = pos[at + 1];
			known.name = pkt.name || known.name;
			return;
		}
		const objecttype = pkt.objecttype;
		this.byGid[gid] = { gid, name: pkt.name || '', x: pos[at], y: pos[at + 1], job: pkt.job, objecttype };
		this.emit('spawn', { gid, objecttype });
	}

	_move(gid, pos, at) {
		const ent = this.byGid[gid];
		if (ent && pos) {
			ent.x = pos[at];
			ent.y = pos[at + 1];
		}
	}

	_vanish(gid) {
		if (!this.byGid[gid]) {
			return;
		}
		const objecttype = this.byGid[gid].objecttype;
		delete this.byGid[gid];
		this.emit('vanish', { gid, objecttype });
	}

	_clear() {
		this.byGid = {};
	}

	/**
	 * @param {number} [objecttype] TYPE_MOB / TYPE_PC — omit for both
	 * @returns {Array<{gid: number, name: string, x: number, y: number, job: number, objecttype: number}>}
	 */
	list(objecttype) {
		const out = [];
		for (const gid in this.byGid) {
			const ent = this.byGid[gid];
			if (objecttype == null || ent.objecttype === objecttype) {
				out.push(ent);
			}
		}
		return out;
	}

	get(gid) {
		return this.byGid[gid] || null;
	}

	count(objecttype) {
		return this.list(objecttype).length;
	}
}

export { TYPE_PC, TYPE_MOB };
