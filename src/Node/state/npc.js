/**
 * Node/state/npc.js
 *
 * NPC dialog tracker — same shape as `state/homun.js`, but the wire model
 * here is a single current dialog (not a keyed collection): every packet
 * carries the talking NPC's `NAID`, and rAthena only ever has one dialog
 * open with the player at a time.
 *
 * `awaiting` names what the dialog wants from the player right now:
 *   - 'none'       just-updated text (SAY_DIALOG), no button implied yet
 *   - 'next'       WAIT_DIALOG — a "next" click is expected
 *   - 'close'      CLOSE_DIALOG — a "close" click is expected
 *   - 'menu'       MENU_LIST — pick one of `options`
 *   - 'input-num'  OPEN_EDITDLG — a numeric input is expected
 *   - 'input-str'  OPEN_EDITDLGSTR — a string input is expected
 *
 * `options` is only populated by MENU_LIST (rAthena joins choices with
 * `\t` — see clif_scriptmenu / packets_struct.hpp); every other transition
 * leaves it as the empty array from the last menu.
 */
import { EventEmitter } from 'node:events';
import PACKET from 'Network/PacketStructure.js';
import { observePacket } from '../net/observe.js';

export class NpcState extends EventEmitter {
	constructor() {
		super();
		this.naid = 0;
		this.text = '';
		this.options = [];
		this.awaiting = 'none';
	}

	install() {
		observePacket(PACKET.ZC.SAY_DIALOG, pkt => this._set(pkt.NAID, { text: pkt.msg, awaiting: 'none' }));
		observePacket(PACKET.ZC.WAIT_DIALOG, pkt => this._set(pkt.NAID, { awaiting: 'next' }));
		observePacket(PACKET.ZC.CLOSE_DIALOG, pkt => this._set(pkt.NAID, { awaiting: 'close' }));
		observePacket(PACKET.ZC.MENU_LIST, pkt =>
			this._set(pkt.NAID, { options: pkt.msg.split('\t').filter(Boolean), awaiting: 'menu' })
		);
		observePacket(PACKET.ZC.OPEN_EDITDLG, pkt => this._set(pkt.NAID, { awaiting: 'input-num' }));
		observePacket(PACKET.ZC.OPEN_EDITDLGSTR, pkt => this._set(pkt.NAID, { awaiting: 'input-str' }));
		return this;
	}

	_set(naid, patch) {
		this.naid = naid;
		if ('text' in patch) {
			this.text = patch.text;
		}
		if ('options' in patch) {
			this.options = patch.options;
		}
		this.awaiting = patch.awaiting;
		this.emit('dialog', { naid: this.naid, text: this.text, options: this.options, awaiting: this.awaiting });
	}

	getNaid() {
		return this.naid;
	}

	getText() {
		return this.text;
	}

	getOptions() {
		return this.options;
	}

	getAwaiting() {
		return this.awaiting;
	}

	get() {
		return { naid: this.naid, text: this.text, options: this.options, awaiting: this.awaiting };
	}
}
