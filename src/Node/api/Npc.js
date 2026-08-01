/**
 * Node/api/Npc.js
 *
 * NPC dialog façade. Reads NpcState (the single current-dialog tracker) and
 * emits the outgoing dialog packets, each gated on what the dialog is
 * `awaiting` right now so a reply never fires against the wrong state.
 * Same resolve → gate → build CZ → send → return {sent, reason?} shape as
 * api/Skill.js; talk() is the initiator (no awaiting gate — the caller
 * supplies the NAID, there is no in-client NPC lookup this session).
 *
 * on()/off() delegate read events ('dialog') to the tracker like Player;
 * the façade's own 'blocked' event lives on its own emitter (RoClient
 * consolidates it onto the flat 'blocked' stream).
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';

export class Npc extends EventEmitter {
	constructor(npcState) {
		super();
		this._s = npcState;
	}

	getNaid() {
		return this._s.getNaid();
	}
	getText() {
		return this._s.getText();
	}
	getOptions() {
		return this._s.getOptions();
	}
	getAwaiting() {
		return this._s.getAwaiting();
	}
	get() {
		return this._s.get();
	}

	on(event, cb) {
		if (event === 'blocked') {
			super.on(event, cb);
		} else {
			this._s.on(event, cb);
		}
		return this;
	}
	off(event, cb) {
		if (event === 'blocked') {
			super.off(event, cb);
		} else {
			this._s.off(event, cb);
		}
		return this;
	}

	/**
	 * Initiate contact with an NPC by its block id (account/npc id). Ungated —
	 * there is no in-client NPC lookup this session, so the NAID must be
	 * supplied by the caller (discover one from node-logs/ or an observeAny tap).
	 *
	 * @param {number} naid the NPC's block id
	 * @returns {{sent: boolean, naid: number}}
	 */
	talk(naid) {
		const pkt = new PACKET.CZ.CONTACTNPC();
		pkt.NAID = naid;
		pkt.type = 1; // 1 = NPC (Aegis enum) — no warp/entity-click flow here
		Network.sendPacket(pkt);
		return { sent: true, naid };
	}

	next() {
		return this._reply('next', PACKET.CZ.REQ_NEXT_SCRIPT);
	}

	close() {
		return this._reply('close', PACKET.CZ.CLOSE_DIALOG);
	}

	/**
	 * Pick a menu option. `index === 255` is the reserved "cancel" value
	 * (closes the menu without picking — same packet, no separate cancel).
	 *
	 * @param {number} index
	 */
	choose(index) {
		return this._reply('menu', PACKET.CZ.CHOOSE_MENU, pkt => {
			pkt.num = index;
		});
	}

	inputNum(value) {
		return this._reply('input-num', PACKET.CZ.INPUT_EDITDLG, pkt => {
			pkt.value = value;
		});
	}

	inputStr(text) {
		return this._reply('input-str', PACKET.CZ.INPUT_EDITDLGSTR, pkt => {
			pkt.msg = text;
		});
	}

	/**
	 * Shared gate-then-send for the response packets: refuse unless the dialog
	 * is awaiting exactly `expected`, else build the CZ packet with the current
	 * NAID, let `fill` set any extra fields, and send.
	 */
	_reply(expected, PacketClass, fill) {
		const awaiting = this._s.getAwaiting();
		if (awaiting !== expected) {
			const reason = 'not awaiting ' + expected;
			this.emit('blocked', { reason });
			return { sent: false, reason };
		}
		const naid = this._s.getNaid();
		const pkt = new PacketClass();
		pkt.NAID = naid;
		if (fill) {
			fill(pkt);
		}
		Network.sendPacket(pkt);
		return { sent: true, naid };
	}
}
