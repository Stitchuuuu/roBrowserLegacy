/**
 * Node/api/RoClient.js
 *
 * Root façade over the live connection. Constructs the state trackers
 * (each taps observePacket immediately, so listeners are armed before the
 * handshake floods state), wires them to the sub-facades (player / party /
 * skill) and re-emits a flat event surface on itself.
 *
 * connect(password) runs the login→char→map handshake (net/session.js) and
 * resolves once in map. Boot (socket factory, PACKETVER, Configs) must have
 * run first — see boot.js — as it does in the client.js entry.
 *
 * Reusable in-browser too: it imports no UI and only Node-safe core.
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import { runSession } from '../net/session.js';
import { PlayerState } from '../state/player.js';
import { PartyState } from '../state/party.js';
import { StatusState } from '../state/status.js';
import { SkillState } from '../state/skills.js';
import { DelayState } from '../state/delay.js';
import { Player } from './Player.js';
import { Party } from './Party.js';
import { Skill } from './Skill.js';
import { Messages } from './messages.js';

export class RoClient extends EventEmitter {
	constructor(cfg) {
		super();
		this._cfg = cfg;
		this.connected = false;

		// Trackers — install() taps observePacket now, before connect().
		this._playerState = new PlayerState().install();
		this._statusState = new StatusState().install();
		this._partyState = new PartyState().install();
		this._skillState = new SkillState().install();
		this._delayState = new DelayState(this._statusState).install();
		this._messages = new Messages().install();

		// Sub-facades.
		this.player = new Player(this._playerState);
		this.party = new Party(this._partyState, this._statusState);
		this.skill = new Skill(this._skillState, this._delayState, this._partyState);

		this._wire();
	}

	_wire() {
		this._playerState.on('hp', e => this.emit('hp', e));
		this._playerState.on('sp', e => this.emit('sp', e));
		this._playerState.on('change', e => this.emit('change', e));

		this._statusState.on('status', e => this.emit('status', e));

		this._partyState.on('list', () => this.emit('party', { reason: 'list' }));
		this._partyState.on('member', () => this.emit('party', { reason: 'member' }));
		this._partyState.on('hp', e => this.emit('party', { reason: 'hp', ...e }));
		this._partyState.on('position', e => this.emit('party', { reason: 'position', ...e }));

		this._skillState.on('list', () => this.emit('skills'));
		this._skillState.on('skill', () => this.emit('skills'));

		this._messages.on('chat', e => this.emit('chat', e));
		this._messages.on('privateMessage', e => this.emit('privateMessage', e));
		this._messages.on('emote', e => this.emit('emote', e));

		this.skill.on('cast', e => this.emit('cast', e));
		this.skill.on('blocked', e => this.emit('blocked', e));

		// Preserve boot's onDisconnect (process.exit path) while surfacing
		// the event to façade listeners first.
		const prev = Network.onDisconnect;
		Network.onDisconnect = () => {
			this.connected = false;
			this.emit('disconnected');
			if (typeof prev === 'function') {
				prev();
			}
		};
	}

	/**
	 * @param {string} password RAM only — never logged, never persisted
	 * @returns {Promise<{mapName: string}>}
	 */
	async connect(password) {
		const result = await runSession(this._cfg, password);
		this.connected = true;
		this.emit('connected', result);
		return result;
	}

	// Root convenience surface (sub-facades carry the detail).
	getSkills() {
		return this.skill.getSkills();
	}
	getParty() {
		return this.party.getMembers();
	}
	doSkill(name, target, level) {
		return this.skill.doSkill(name, target, level);
	}
	say(text) {
		return this._messages.say(text);
	}
	sayParty(text) {
		return this._messages.sayParty(text);
	}
	whisper(name, text) {
		return this._messages.whisper(name, text);
	}
	emote(name) {
		return this._messages.emote(name);
	}
}
