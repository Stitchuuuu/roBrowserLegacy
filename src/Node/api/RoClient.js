/**
 * Node/api/RoClient.js
 *
 * Root façade over the live connection. Constructs the state trackers
 * (each taps observePacket immediately, so listeners are armed before the
 * handshake floods state), wires them to the sub-facades (player / party /
 * skill / homun) and re-emits a flat event surface on itself.
 *
 * connect(password) runs the login→char→map handshake (net/session.js) and
 * resolves once in map. Boot (socket factory, PACKETVER, Configs) must have
 * run first — see boot.js — as it does in the client.js entry.
 *
 * Reusable in-browser too: it imports no UI and only Node-safe core.
 */
import { EventEmitter } from 'node:events';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import Session from 'Engine/SessionStorage.js';
import { observePacket } from '../net/observe.js';
import { runSession } from '../net/session.js';
import { PlayerState } from '../state/player.js';
import { PartyState } from '../state/party.js';
import { StatusState } from '../state/status.js';
import { SkillState } from '../state/skills.js';
import { DelayState } from '../state/delay.js';
import { HomunState } from '../state/homun.js';
import { CastState } from '../state/casts.js';
import { EntityState, TYPE_PC } from '../state/entities.js';
import { InventoryState } from '../state/inventory.js';
import { StorageState } from '../state/storage.js';
import { NpcState } from '../state/npc.js';
import { Player } from './Player.js';
import { Party } from './Party.js';
import { Skill } from './Skill.js';
import { Messages } from './messages.js';
import { logWhisper } from '../net/whisperlog.js';
import { alert } from '../net/notify.js';

export class RoClient extends EventEmitter {
	constructor(cfg) {
		super();
		this._cfg = cfg;
		this.connected = false;
		this.currentMap = null; // our current map (set on connect, updated on warp)

		// Keep the current map live so routines can gate on "same map". Both
		// warp acks carry it — MAPMOVE within a zone, SERVERMOVE across zones.
		observePacket(PACKET.ZC.NPCACK_MAPMOVE, pkt => {
			this.currentMap = pkt.mapName;
		});
		observePacket(PACKET.ZC.NPCACK_SERVERMOVE, pkt => {
			this.currentMap = pkt.mapName;
		});

		// Trackers — install() taps observePacket now, before connect().
		this._playerState = new PlayerState().install();
		this._statusState = new StatusState().install();
		this._partyState = new PartyState().install();
		this._skillState = new SkillState().install();
		this._delayState = new DelayState(this._statusState).install();
		this._homunState = new HomunState().install();
		this._castState = new CastState().install();
		this._entityState = new EntityState().install();
		this._inventoryState = new InventoryState().install();
		this._storageState = new StorageState().install();
		this._npcState = new NpcState().install();
		this._messages = new Messages().install();

		// Sub-facades.
		this.player = new Player(this._playerState);
		this.party = new Party(this._partyState, this._statusState);
		this.skill = new Skill(this._skillState, this._delayState, this._partyState);
		// No façade of its own — the tracker's read API is already the friendly one.
		this.homun = this._homunState;
		this.entities = this._entityState;
		this.inventory = this._inventoryState;
		this.storage = this._storageState;
		this.npc = this._npcState;

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

		// A USESKILL_ACK for our own cast — the server accepted it (used by routines
		// to detect a silently-dropped cast: sent, but no ack).
		this._delayState.on('cast', e => this.emit('castAck', e));

		// Homunculus presence, collapsed into one event with a reason (the
		// `party` idiom above). 'own' = the server told us our own homun's id.
		this._homunState.on('spawn', e => this.emit('homun', { reason: 'spawn', gid: e.gid }));
		this._homunState.on('vanish', e => this.emit('homun', { reason: 'vanish', gid: e.gid }));
		this._homunState.on('own', e => this.emit('homun', { reason: 'own', gid: e.gid }));

		// A no-damage skill reached castend on some unit — the only "the buff
		// applied" signal for targets whose EFST is never broadcast.
		this._castState.on('skillUsed', e => this.emit('skillUsed', e));

		// Entity presence, collapsed into one event with a reason (the `party`
		// idiom above). Player-cross alert: a TYPE_PC spawn that isn't self or
		// a party member (both keyed by AID — the block id the entry packets
		// carry as `gid`, see state/entities.js and resolve/targets.js).
		this._entityState.on('spawn', e => {
			this.emit('entity', { reason: 'spawn', gid: e.gid, objecttype: e.objecttype });
			if (e.objecttype === TYPE_PC && e.gid !== Session.AID && !this._partyState.getByAid(e.gid)) {
				const ent = this._entityState.get(e.gid);
				alert({ title: 'Ragnarok — player in zone', body: (ent && ent.name) || 'Unknown player' });
			}
		});
		this._entityState.on('vanish', e =>
			this.emit('entity', { reason: 'vanish', gid: e.gid, objecttype: e.objecttype })
		);

		this._inventoryState.on('list', () => this.emit('inventory', { reason: 'list' }));
		this._inventoryState.on('add', e => this.emit('inventory', { reason: 'add', index: e.index }));
		this._inventoryState.on('remove', e => this.emit('inventory', { reason: 'remove', index: e.index }));

		this._storageState.on('open', () => this.emit('storage', { reason: 'open' }));
		this._storageState.on('close', () => this.emit('storage', { reason: 'close' }));
		this._storageState.on('list', () => this.emit('storage', { reason: 'list' }));
		this._storageState.on('add', e => this.emit('storage', { reason: 'add', index: e.index }));
		this._storageState.on('remove', e => this.emit('storage', { reason: 'remove', index: e.index }));

		this._npcState.on('dialog', e => this.emit('dialog', e));

		this._messages.on('chat', e => this.emit('chat', e));
		this._messages.on('privateMessage', e => {
			this.emit('privateMessage', e);
			logWhisper(e);
			alert({ title: 'Ragnarok — whisper from ' + e.sender, body: e.msg });
		});
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
	 * @param {{chooseChar?: function(Array): (number|Promise<number>)}} [opts]
	 *        forwarded to runSession — interactive char select (inline setup).
	 * @returns {Promise<{mapName: string}>}
	 */
	async connect(password, opts = {}) {
		const result = await runSession(this._cfg, password, opts);
		this.connected = true;
		this.currentMap = result.mapName;
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
