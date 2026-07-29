/**
 * Node/state/homun.js
 *
 * Homunculus tracker — a deliberately narrow slice of the entity tracker
 * (jalon 2): only TYPE_HOM units, only the fields a buff routine needs
 * (id, name, cell). Everything else on the wire is ignored.
 *
 * Two independent sources, because they answer different questions:
 *  - ZC.CHANGESTATE_MER with state 0 (SP_ACK) is SELF-addressed and tells us
 *    OUR OWN homun's block id. The server sends it on summon / revive / login
 *    (homunculus.cpp:1143, :1214, :1345), right after clif_spawn().
 *  - the entry packets tell us about ANY homun in view, ours included. They
 *    carry no owner field at all (see the note below), so attributing one to a
 *    party member is the routine's problem, not the tracker's.
 *
 * Only the *11 entry variants are observed: the entry opcodes are a hard
 * function of PACKETVER (rAthena packets_struct.hpp — idle 0x9ff, spawn 0x9fe,
 * walking 0x9fd for PACKETVER >= 20150513), not a per-server choice, so at
 * 20211103 no other variant can arrive. Targeting an older client means adding
 * the matching variants here.
 *
 * ⚠️ Index by `pkt.GID`. roBrowser reads the wire's first u32 (rAthena's `AID`,
 * the map block id — the value you target with CZ.USE_SKILL2) into `GID`, and
 * the second (char_id) into `AID`. For a homunculus that second field is always
 * 0, and there is NO field anywhere carrying the master's id: clif_set_unit_idle
 * fills GID with `(sd) ? sd->status.char_id : 0` (clif.cpp:1106). The only
 * owner-derived data a homun broadcasts is its master's guild id.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

const TYPE_HOM = 8; // Renderer/Entity/Entity.js — inlined; that module pulls the renderer in
const SP_ACK = 0; // e_hom_state2 (homunculus.hpp) — "homunculus is now active"

export class HomunState extends EventEmitter {
	constructor() {
		super();
		this.byGid = {}; // gid → { gid, name, x, y } — TYPE_HOM units in view
		this.ownId = 0; // our own homun's block id (0 = none / vaporized)
		this.lastSeen = {}; // gid → ms of its last vanish; survives removal (re-summon check)
	}

	install() {
		observePacket(PACKET.ZC.CHANGESTATE_MER, pkt => {
			if (pkt.state === SP_ACK) {
				this.ownId = pkt.GID;
				this.emit('own', { gid: pkt.GID });
			}
		});

		// Entry packets: idle / spawning units carry a packed PosDir, a walking
		// one carries a start+destination pair — snap to the destination.
		observePacket(PACKET.ZC.NOTIFY_STANDENTRY11, pkt => this._onEntry(pkt, pkt.PosDir, 0));
		observePacket(PACKET.ZC.NOTIFY_NEWENTRY11, pkt => this._onEntry(pkt, pkt.PosDir, 0));
		observePacket(PACKET.ZC.NOTIFY_MOVEENTRY11, pkt => this._onEntry(pkt, pkt.MoveData, 2));

		// Position refresh for a unit already in view. Neither emits: they fire
		// on every step of every homun on screen, and a routine reads positions
		// on demand rather than waking on them.
		observePacket(PACKET.ZC.NOTIFY_MOVE, pkt => this._move(pkt.GID, pkt.MoveData, 2));
		// STOPMOVE is absolute and authoritative (clif_fixpos); its `AID` field
		// is a block id despite the name, so it keys the same map.
		observePacket(PACKET.ZC.STOPMOVE, pkt => {
			const hom = this.byGid[pkt.AID];
			if (hom) {
				hom.x = pkt.xPos;
				hom.y = pkt.yPos;
			}
		});

		observePacket(PACKET.ZC.NOTIFY_VANISH, pkt => this._vanish(pkt.GID));

		// Map change re-creates every unit with fresh block ids, so anything we
		// hold is a ghost. `lastSeen` is kept — it is what tells a re-summon
		// apart from a homun simply walking back into view.
		observePacket(PACKET.ZC.NPCACK_MAPMOVE, () => this._clear());
		observePacket(PACKET.ZC.NPCACK_SERVERMOVE, () => this._clear());
		return this;
	}

	// `pos` is readPos() ([x, y, dir]) or readPos2() ([x1, y1, x2, y2, …]);
	// `at` selects which cell pair to read.
	_onEntry(pkt, pos, at) {
		if (pkt.objecttype !== TYPE_HOM || !pos) {
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
		this.byGid[gid] = { gid, name: pkt.name || '', x: pos[at], y: pos[at + 1] };
		this.emit('spawn', { gid });
	}

	_move(gid, pos, at) {
		const hom = this.byGid[gid];
		if (hom && pos) {
			hom.x = pos[at];
			hom.y = pos[at + 1];
		}
	}

	_vanish(gid) {
		if (!this.byGid[gid]) {
			return;
		}
		delete this.byGid[gid];
		this.lastSeen[gid] = Date.now();
		if (gid === this.ownId) {
			this.ownId = 0;
		}
		this.emit('vanish', { gid });
	}

	_clear() {
		for (const gid in this.byGid) {
			this.lastSeen[gid] = Date.now();
		}
		this.byGid = {};
		this.ownId = 0;
	}

	getOwnId() {
		return this.ownId;
	}

	/**
	 * @returns {Array<{gid: number, name: string, x: number, y: number}>} live
	 *          entries (not copies) — read-only by convention
	 */
	list() {
		const out = [];
		for (const gid in this.byGid) {
			out.push(this.byGid[gid]);
		}
		return out;
	}

	get(gid) {
		return this.byGid[gid] || null;
	}

	// ms timestamp of this homun's last disappearance (0 = never seen to leave).
	lastSeenAt(gid) {
		return this.lastSeen[gid] || 0;
	}
}
