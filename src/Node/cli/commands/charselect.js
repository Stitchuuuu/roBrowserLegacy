/**
 * /charselect — return to character select and re-enter map WITHOUT logging
 * out. Uses the RO-native CZ.RESTART(type=1) path, so it never re-authenticates
 * and never asks for the password. Shows the same interactive picker as /login.
 */
import Session from 'Engine/SessionStorage.js';
import { selectCharacter } from '../charselect.js';
import { saveConfig, charKey } from '../../config.js';
import { log } from '../../log.js';

export default {
	name: 'charselect',
	aliases: ['cs'],
	help: 'return to character select (no logout, no password)',
	async run(ctx) {
		const screen = ctx.screen;
		const cfg = ctx.config;
		const chooseChar = async list => {
			screen.pauseInput();
			try {
				return await selectCharacter(list, { defaultSlot: cfg.server.charSlot });
			} finally {
				screen.resumeInput();
			}
		};

		log.event('returning to character select…');
		try {
			const result = await ctx.session.returnToCharSelect(chooseChar);
			// Persist the pick (mirrors /login) so auto-reconnect and the next
			// launch keep this character instead of reverting to the old slot.
			const chosen = Session.Character;
			if (chosen) {
				cfg.server.charSlot = chosen.CharNum;
				saveConfig({
					server: cfg.server,
					account: { login: cfg.account.login },
					characters: { [charKey(cfg)]: { name: chosen.name, charSlot: chosen.CharNum } }
				});
			}
			log.event('re-entered ' + result.mapName + ' as ' + ctx.client.player.name);
		} catch (err) {
			log.event('charselect failed: ' + err.message);
		}
	}
};
