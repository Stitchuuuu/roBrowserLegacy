/**
 * /login [user] [pass] — (re)connect, optionally switching account.
 *
 * Password: inline arg, else a masked prompt (RAM only, never saved). On an
 * account switch (or an unknown character) it re-runs the interactive char
 * select. On success it persists server + account + chosen char to
 * config.local.json (never the password).
 */
import Session from 'Engine/SessionStorage.js';
import { rawPrompt, saveConfig, charKey } from '../../config.js';
import { selectCharacter } from '../charselect.js';
import { log } from '../../log.js';

export default {
	name: 'login',
	aliases: ['l'],
	usage: '[user] [pass]',
	help: '(re)connect, optionally switching account',
	async run(ctx, args) {
		const cfg = ctx.config;
		const screen = ctx.screen;
		const prevLogin = cfg.account.login;
		const newUser = args[0];
		if (newUser) {
			cfg.account.login = newUser;
		}
		const accountChanged = !!newUser && newUser !== prevLogin;

		// Password — inline or masked prompt (screen dropped for the modal).
		let password = args[1];
		if (!password) {
			screen.pauseInput();
			try {
				const r = await rawPrompt('Password: ', { mask: true });
				password = r.value;
			} finally {
				screen.resumeInput();
			}
		}
		if (!password) {
			log.event('login cancelled (no password)');
			return;
		}

		const known = cfg.characters && cfg.characters[charKey(cfg)];
		const needSelect = accountChanged || !known;
		const chooseChar = needSelect
			? async list => {
					screen.pauseInput();
					try {
						return await selectCharacter(list, { defaultSlot: cfg.server.charSlot });
					} finally {
						screen.resumeInput();
					}
				}
			: undefined;

		ctx.session.logout();
		log.event('logging in as ' + cfg.account.login + '…');
		try {
			const result = await ctx.session.login(password, chooseChar ? { chooseChar } : {});
			const chosen = Session.Character;
			if (chosen) {
				cfg.server.charSlot = chosen.CharNum;
			}
			const key = charKey(cfg);
			saveConfig({
				server: cfg.server,
				account: { login: cfg.account.login },
				characters: {
					[key]: { name: chosen ? chosen.name : '', charSlot: chosen ? chosen.CharNum : cfg.server.charSlot }
				}
			});
			log.event('logged in as ' + cfg.account.login + ' — ' + result.mapName + ' (config saved)');
		} catch (err) {
			log.event('login failed: ' + err.message);
		}
	}
};
