/**
 * Node/api/messages.js
 *
 * Chat / whisper / emote façade. Public and party chat prefix the sender
 * name ("<name> : text", per MapEngine.js:onRequestTalk); whisper is raw
 * text with a fixed 24-byte receiver. Headless has no Session.Entity, so
 * the name comes from Session.Character.name.
 *
 * Emote name→type uses DB/Emotions.js `.commands` (a pure table).
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import Session from 'Engine/SessionStorage.js';
import Emotions from 'DB/Emotions.js';
import { observePacket } from '../net/observe.js';

export class Messages extends EventEmitter {
	install() {
		observePacket(PACKET.ZC.NOTIFY_CHAT, pkt => this.emit('chat', { gid: pkt.GID, msg: pkt.msg }));
		observePacket(PACKET.ZC.NOTIFY_PLAYERCHAT, pkt =>
			this.emit('chat', { gid: Session.GID, msg: pkt.msg, self: true })
		);
		observePacket(PACKET.ZC.WHISPER, pkt => this.emit('privateMessage', { sender: pkt.sender, msg: pkt.msg }));
		observePacket(PACKET.ZC.WHISPER2, pkt => this.emit('privateMessage', { sender: pkt.sender, msg: pkt.msg }));
		observePacket(PACKET.ZC.EMOTION, pkt => this.emit('emote', { gid: pkt.GID, type: pkt.type }));
		return this;
	}

	_name() {
		return (Session.Character && Session.Character.name) || 'Player';
	}

	say(text) {
		const pkt = new PACKET.CZ.REQUEST_CHAT();
		pkt.msg = this._name() + ' : ' + text;
		Network.sendPacket(pkt);
	}

	sayParty(text) {
		const pkt = new PACKET.CZ.REQUEST_CHAT_PARTY();
		pkt.msg = this._name() + ' : ' + text;
		Network.sendPacket(pkt);
	}

	whisper(name, text) {
		const pkt = new PACKET.CZ.WHISPER();
		pkt.receiver = name;
		pkt.msg = text;
		Network.sendPacket(pkt);
	}

	/**
	 * @param {string} name emote command token (e.g. 'thx', 'no1')
	 * @returns {{sent: boolean, type?: number, reason?: string}}
	 */
	emote(name) {
		const type = Emotions.commands[String(name).toLowerCase()];
		if (type == null) {
			return { sent: false, reason: 'unknown emote' };
		}
		const pkt = new PACKET.CZ.REQ_EMOTION();
		pkt.type = type;
		Network.sendPacket(pkt);
		return { sent: true, type };
	}
}
