/**
 * Node/Session.js
 *
 * In-RAM session lifecycle over a single RoClient: holds the credentials
 * (login lives in cfg; the password is kept in memory ONLY, never disk/log)
 * for the process lifetime, owns Network.onDisconnect to auto-reconnect on a
 * transient drop (instead of boot's process.exit), and tracks the active
 * auto-pilot routines so they survive a reconnect and can be stopped hot.
 *
 * Named ClientSession to avoid clashing with Engine/SessionStorage.js (the
 * game-side Session singleton, imported elsewhere as `Session`). Lives at
 * src/Node/ (not net/) because the filesystem is case-insensitive and
 * net/Session.js would collide with net/session.js. Mono-account,
 * mono-character per process.
 */
import Network from 'Network/NetworkManager.js';
import { createRoutine } from './routines/registry.js';
import { SecretBox } from './secret.js';
import { log } from './log.js';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export class ClientSession {
	/**
	 * @param {object} cfg loadConfig() result (mutated in RAM on /login)
	 * @param {import('./api/RoClient.js').RoClient} client
	 */
	constructor(cfg, client) {
		this.cfg = cfg;
		this.client = client;
		// Password: encrypted at rest in RAM (per-process key), decrypted only at
		// the moment of the CA.LOGIN send — kept for the process lifetime so
		// auto-reconnect can relogin. Never persisted, never logged. See secret.js.
		this._secret = new SecretBox();
		this.activeRoutines = {}; // name → routine instance (mono per name)
		this._reconnecting = false;
		this._quitting = false;
		this._suppressReconnect = false; // set by logout(); cleared by login()
	}

	/** @param {string} password kept encrypted in RAM (never flat) */
	setPassword(password) {
		this._secret.set(password);
	}

	/**
	 * Connect (or re-connect after a /login account switch). Installs the
	 * auto-reconnect handler only after the first success so an initial bad
	 * credential still surfaces as a normal connect rejection.
	 *
	 * @param {?string} password overrides the stored one (kept in RAM)
	 * @param {{chooseChar?: function(Array): (number|Promise<number>)}} [opts]
	 * @returns {Promise<{mapName: string}>}
	 */
	async login(password, opts = {}) {
		if (password != null) {
			this._secret.set(password);
		}
		this._suppressReconnect = false;
		// Decrypt transiently just for the connect (login send); pw goes out of
		// scope right after — the stored copy stays encrypted.
		const result = await this.client.connect(this._secret.get(), opts);
		this._installReconnect();
		return result;
	}

	/**
	 * Voluntary disconnect that does NOT auto-reconnect (for /login account
	 * switch and /logout). Stops routines and closes the socket; a following
	 * login() re-arms reconnect.
	 */
	logout() {
		this._suppressReconnect = true;
		for (const name of this.listRoutines()) {
			this.stopRoutine(name);
		}
		try {
			Network.close();
		} catch {
			// already closed
		}
		this.client.connected = false;
	}

	_installReconnect() {
		Network.onDisconnect = () => this._onDrop();
	}

	_onDrop() {
		// The reconnect loop owns retries; ignore the transient closes it causes.
		// _suppressReconnect covers a voluntary logout / account switch.
		if (this._quitting || this._reconnecting || this._suppressReconnect) {
			return;
		}
		this.client.connected = false;
		this.client.emit('disconnected');
		log.warn('connection dropped — reconnecting…');
		this._reconnectLoop();
	}

	async _reconnectLoop() {
		if (this._reconnecting) {
			return;
		}
		this._reconnecting = true;

		for (let attempt = 0; !this._quitting; ++attempt) {
			const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
			log.warn('reconnect attempt ' + (attempt + 1) + ' in ' + wait / 1000 + 's');
			await sleep(wait);
			if (this._quitting) {
				break;
			}
			try {
				const result = await this.client.connect(this._secret.get());
				log.event('reconnected — in map ' + result.mapName);
				this._reconnecting = false;
				this._rearmRoutines();
				this.client.emit('reconnected', result);
				return;
			} catch (err) {
				log.warn('reconnect failed:', err.message);
			}
		}
		this._reconnecting = false;
	}

	// Routine listeners/timers live on the (unchanged) RoClient, so they survive
	// a reconnect — a fresh evaluation tick is all that's needed once state has
	// been re-flooded by the new handshake.
	_rearmRoutines() {
		for (const name in this.activeRoutines) {
			const routine = this.activeRoutines[name];
			if (typeof routine.onReconnect === 'function') {
				routine.onReconnect();
			}
		}
	}

	/**
	 * @param {string} name routine registry key
	 * @param {string[]} args
	 * @param {object} ctx passed to the routine ({ session, client, config, log })
	 * @returns {{ok: boolean, reason?: string, routine?: object}}
	 */
	startRoutine(name, args, ctx) {
		const routine = createRoutine(name);
		if (!routine) {
			return { ok: false, reason: 'unknown routine "' + name + '"' };
		}
		this.stopRoutine(name);
		this.activeRoutines[name] = routine;
		routine.start(this.client, args, ctx);
		return { ok: true, routine };
	}

	stopRoutine(name) {
		const routine = this.activeRoutines[name];
		if (routine) {
			routine.stop();
			delete this.activeRoutines[name];
			return true;
		}
		return false;
	}

	listRoutines() {
		return Object.keys(this.activeRoutines);
	}

	getRoutine(name) {
		return this.activeRoutines[name] || null;
	}

	// index.js flips this before the clean-quit disconnect so the drop doesn't
	// trigger a reconnect race against process exit.
	quit() {
		this._quitting = true;
	}
}
