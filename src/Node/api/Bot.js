/**
 * Node/api/Bot.js
 *
 * The awaitable façade handed to a macro (`export default async bot => {…}`,
 * see macro/loader.js). It owns no state and builds no packets: every action
 * calls a session-2 sender on RoClient (api/Player.js, api/Npc.js, api/Item.js,
 * api/Skill.js, api/Storage.js) — which returns `{sent, reason?, …}`
 * synchronously — then awaits, through RoClient.waitFor, the one event the
 * matching tracker emits when the server committed it. That await is what turns
 * a fire-and-return sender into a macro step.
 *
 * One AbortSignal per run, injected at construction and merged into every await
 * (_opts). A macro overrides `timeout` per action but never the signal: an
 * unabortable await defeats the instant stop this layer exists for. sleep()
 * rejects with waitFor's own ABORTED sentinel so the loader keeps ONE
 * clean-stop test.
 *
 * Send-then-subscribe is safe: the sender call and the waitFor subscribe sit in
 * one synchronous block, and no socket data can be delivered between them
 * (single-threaded, no await in between) — so the confirmation cannot be missed.
 *
 * Confirmation events, each verified against the tracker that emits it:
 *   moveTo        'change'    field 'pos' at the requested cell   state/player.js
 *   npc replies   'dialog'    first event whose `awaiting` is actionable
 *   useItem       'inventory' reason 'use' on the used slot       state/inventory.js
 *   doSkill/…     'castAck'   ZC.USESKILL_ACK for that skid       state/delay.js:69
 *   deposit       'inventory' reason 'remove' on the source slot
 *   withdraw      'storage'   reason 'remove' on the source slot
 *   storageClose  'storage'   reason 'close' (the ZC.CLOSE_STORE echo)
 *
 * useItem is the one action whose confirmation is NOT a delete: consuming an
 * item acks with ZC.USE_ITEM_ACK and then deletes with clif_delitem suppressed
 * (rathena pc.cpp:6534-6536 + :6120), so no DELETE_ITEM_FROM_BODY ever arrives
 * and an await on 'remove' would time out on every successful potion. The ack
 * carries the server's own ok/fail, so a use the server refuses throws at once
 * instead of burning the timeout.
 *
 * NOT RoClient's 'cast' (api/RoClient.js:159): that is the *local send echo*,
 * emitted synchronously inside the sender, and waitFor only sees future firings
 * — awaiting it would hang forever. Storage moves await the SOURCE removal
 * because only that side carries the index the sender returned (api/Storage.js);
 * the destination 'add' index is server-chosen, so it could only be matched by a
 * bare reason check an unrelated pickup would satisfy mid-farm.
 *
 * NPC dialogs: one script step commonly pushes SAY_DIALOG (awaiting 'none') and
 * then WAIT_DIALOG / MENU_LIST / … (state/npc.js:36-58). 'none' means "text
 * updated, nothing to reply to yet", and every reply sender gates on a concrete
 * `awaiting` (api/Npc.js:119) — so resolving on it would leave the macro's next
 * bot.next() refused by the gate. The await skips 'none' and resolves on the
 * first actionable prompt; each npc action's postcondition is then exactly the
 * next one's precondition, so talk → next → choose chains. close() is the
 * exception: rAthena ends the script on CZ.CLOSE_DIALOG and sends nothing back,
 * so it has nothing to await — a macro expecting the script to continue past it
 * (a warp, another dialog) waits explicitly via bot.waitFor.
 *
 * moveTo does NOT confirm arrival. ZC.NOTIFY_PLAYERMOVE's MoveData[2],[3] is the
 * walk DESTINATION and PlayerState snaps to it at walk *start* (state/player.js:52
 * and :107-112); rAthena sends no packet when a normal walk completes. So
 * `await bot.moveTo(x, y)` means "the server accepted the walk and committed us
 * to that cell" — roughly one round-trip after the send, NOT "we are physically
 * standing there". A macro needing real arrival must estimate it with sleep().
 *
 * Gate-miss policy: a sender's `{sent:false}` throws '<action> refused: <reason>'
 * — EXCEPT when the refusal means the postcondition already holds (moveTo
 * 'already there', storageClose 'storage not open'), where the bot resolves
 * without awaiting. A macro bug ('not awaiting menu', 'not in inventory',
 * 'unknown skill', 'after-cast delay') must stop the run rather than let a farm
 * loop spin silently on no-ops. Those messages can never equal ABORTED, so the
 * loader still tells a clean stop apart from a real failure.
 *
 * Every action resolves with the *sender's own result object* on every path
 * (awaited, or skipped as already-satisfied) — never the event payload. Trackers
 * update their fields before they emit, so bot.npc.getText(), bot.player.x and
 * bot.inventory.list() are already current when the await returns.
 */
import { ABORTED } from '../waitFor.js';

export class Bot {
	/**
	 * @param {import('./RoClient.js').RoClient} client
	 * @param {AbortSignal} signal the run's signal — carried by every await
	 */
	constructor(client, signal) {
		this._client = client;
		this._signal = signal;

		// Read-only passthroughs. Plain properties, not getters: RoClient builds
		// these once and never reassigns them (api/RoClient.js:82-90), and their
		// own accessors already read live tracker fields.
		this.player = client.player;
		this.npc = client.npc;
		this.inventory = client.inventory;
		this.storage = client.storage;
		this.entities = client.entities;
		// Exposed because 'after-cast delay' is the one *transient* refusal:
		// skill.canCast() / skill.remaining() is how a macro avoids that throw.
		this.skill = client.skill;
	}

	/**
	 * Wait on the client's flat event surface with the run's signal already in.
	 *
	 * @param {string} event
	 * @param {function(*): boolean} [predicate]
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<*>} the accepted payload
	 */
	waitFor(event, predicate, opts) {
		return this._client.waitFor(event, predicate, this._opts(opts));
	}

	/**
	 * Abortable pause. Session.js's private sleep is un-abortable, so macros get
	 * this one: same cleanup discipline as waitFor.js (clear the timer AND drop
	 * the abort listener on every exit path), same rejection sentinel.
	 *
	 * @param {number} ms
	 * @returns {Promise<void>}
	 */
	sleep(ms) {
		const signal = this._signal;
		return new Promise((resolve, reject) => {
			// Already aborted → reject without ever subscribing.
			if (signal && signal.aborted) {
				reject(new Error(ABORTED));
				return;
			}
			let timer = null;
			const cleanup = () => {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				if (signal) {
					signal.removeEventListener('abort', onAbort);
				}
			};
			const onAbort = () => {
				cleanup();
				reject(new Error(ABORTED));
			};
			timer = setTimeout(() => {
				cleanup();
				resolve();
			}, ms);
			if (signal) {
				signal.addEventListener('abort', onAbort);
			}
		});
	}

	// Actions. All async so a sender throwing synchronously still surfaces as a
	// rejection at the loader's boundary rather than inside the macro's caller.

	/**
	 * @param {number} x target cell
	 * @param {number} y target cell
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<{sent: boolean, reason?: string, x?: number, y?: number}>}
	 */
	async moveTo(x, y, opts) {
		const res = this.player.moveTo(x, y);
		if (!res.sent && res.reason === 'already there') {
			return res; // postcondition already holds — nothing to await
		}
		return this._confirm(
			'moveTo',
			res,
			'change',
			e => e.field === 'pos' && e.value.x === x && e.value.y === y,
			opts
		);
	}

	/**
	 * @param {number} naid the NPC's block id (discover one with /entities)
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<{sent: boolean, naid: number}>}
	 */
	async talk(naid, opts) {
		return this._dialog('talk', this.npc.talk(naid), opts);
	}

	/** @returns {Promise<{sent: boolean, naid: number}>} */
	async next(opts) {
		return this._dialog('next', this.npc.next(), opts);
	}

	/**
	 * @param {number} index 1-based menu entry; 255 cancels (api/Npc.js:90)
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<{sent: boolean, naid: number}>}
	 */
	async choose(index, opts) {
		return this._dialog('choose', this.npc.choose(index), opts);
	}

	/** @returns {Promise<{sent: boolean, naid: number}>} */
	async inputNum(value, opts) {
		return this._dialog('inputNum', this.npc.inputNum(value), opts);
	}

	/** @returns {Promise<{sent: boolean, naid: number}>} */
	async inputStr(text, opts) {
		return this._dialog('inputStr', this.npc.inputStr(text), opts);
	}

	/**
	 * Reply "close". The one npc action with nothing to await — see the header.
	 *
	 * @returns {Promise<{sent: boolean, naid: number}>}
	 */
	async close() {
		const res = this.npc.close();
		if (!res.sent) {
			throw new Error('close refused: ' + res.reason);
		}
		return res;
	}

	/**
	 * @param {number|string} target inventory slot, item id, or best-effort name
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<{sent: boolean, reason?: string, index?: number}>}
	 */
	async useItem(target, opts) {
		const res = this.inventory.use(target);
		if (!res.sent) {
			throw new Error('useItem refused: ' + res.reason);
		}
		// ZC.USE_ITEM_ACK, not a delete packet — see the header. The ack also
		// carries the server's verdict, so a refused use fails fast instead of
		// burning the timeout.
		const ack = await this.waitFor('inventory', e => e.reason === 'use' && e.index === res.index, opts);
		if (!ack.ok) {
			throw new Error('useItem rejected by the server: slot ' + res.index);
		}
		return res;
	}

	/**
	 * @returns {Promise<{sent: boolean, reason?: string, skid?: number, level?: number, target?: number}>}
	 */
	async doSkill(name, target, level, opts) {
		return this._cast('doSkill', this.skill.doSkill(name, target, level), opts);
	}

	/**
	 * @returns {Promise<{sent: boolean, reason?: string, skid?: number, level?: number, x?: number, y?: number}>}
	 */
	async castGround(name, x, y, level, opts) {
		return this._cast('castGround', this.skill.castGround(name, x, y, level), opts);
	}

	/**
	 * @param {number|string} indexOrName inventory slot, item id, or name
	 * @param {number} [count] defaults to the whole stack
	 * @param {{timeout?: number}} [opts]
	 * @returns {Promise<{sent: boolean, reason?: string, index?: number, count?: number}>}
	 */
	async deposit(indexOrName, count, opts) {
		const res = this.storage.deposit(indexOrName, count);
		return this._confirm('deposit', res, 'inventory', e => e.reason === 'remove' && e.index === res.index, opts);
	}

	/** @returns {Promise<{sent: boolean, reason?: string, index?: number, count?: number}>} */
	async withdraw(indexOrName, count, opts) {
		const res = this.storage.withdraw(indexOrName, count);
		return this._confirm('withdraw', res, 'storage', e => e.reason === 'remove' && e.index === res.index, opts);
	}

	/** @returns {Promise<{sent: boolean, reason?: string}>} */
	async storageClose(opts) {
		const res = this.storage.close();
		if (!res.sent && res.reason === 'storage not open') {
			return res; // postcondition already holds — nothing to await
		}
		return this._confirm('storageClose', res, 'storage', e => e.reason === 'close', opts);
	}

	// Operator comms — fire-and-forget, nothing to confirm (api/messages.js).
	say(text) {
		return this._client.say(text);
	}

	whisper(name, text) {
		return this._client.whisper(name, text);
	}

	// Merge the run's signal into a caller's opts. Written last on purpose: a
	// macro may override `timeout`, never drop abortability.
	_opts(opts) {
		return { ...opts, signal: this._signal };
	}

	/**
	 * Send-result → await-confirmation. A refusal that does not already satisfy
	 * the action's goal stops the run here (see the header's gate-miss policy).
	 *
	 * @returns {Promise<object>} `res` itself, once the server confirmed
	 */
	async _confirm(action, res, event, predicate, opts) {
		if (!res.sent) {
			throw new Error(action + ' refused: ' + res.reason);
		}
		await this.waitFor(event, predicate, opts);
		return res;
	}

	// A dialog step is confirmed by the first event the macro can reply to —
	// 'none' is a mid-step text update, not a turn boundary (state/npc.js:10).
	_dialog(action, res, opts) {
		return this._confirm(action, res, 'dialog', e => e.awaiting !== 'none', opts);
	}

	// ZC.USESKILL_ACK for our own AID (state/delay.js:59-75) — the server's real
	// "cast accepted", unlike RoClient's synchronous local 'cast' echo.
	_cast(action, res, opts) {
		return this._confirm(action, res, 'castAck', e => e.skid === res.skid, opts);
	}
}
