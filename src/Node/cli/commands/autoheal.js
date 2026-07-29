/**
 * /autoheal <profile> [threshold=.. stopat=.. self=on|off party=on|off] | off
 *
 * Forms:
 *  - /autoheal off                     → stop the routine (session stays in map).
 *  - /autoheal <profile>               → start a saved profile (or a new one with
 *                                         defaults if it doesn't exist yet).
 *  - /autoheal <profile> key=val…      → define / update the profile's fields,
 *                                         save, then start it.
 *
 * Fields: threshold / stopat (HP fraction 0–1), self / party (on|off). Heal is
 * cast on any target below `threshold` and chained until it climbs above
 * `stopat`. Profiles are stored per character
 * (config.characters["<login>/<slot>"].autoheal[name]) — same multi-config shape
 * as /autobuff.
 */
import { saveConfig, charKey } from '../../config.js';
import { log } from '../../log.js';

const DEFAULTS = { threshold: 0.5, stopAt: 0.9, self: true, party: true };
const FIELD_KEYS = { threshold: 'threshold', stopat: 'stopAt', self: 'self', party: 'party' };

function parseBool(v) {
	const s = String(v).toLowerCase();
	if (s === 'on' || s === 'true' || s === '1' || s === 'yes') {
		return true;
	}
	if (s === 'off' || s === 'false' || s === '0' || s === 'no') {
		return false;
	}
	return null;
}

export default {
	name: 'autoheal',
	aliases: ['ah'],
	usage: '<profile> [threshold=.. stopat=.. self=on|off party=on|off] | off',
	help: 'heal self + party below an HP threshold (named profile)',
	run(ctx, args) {
		if (!args.length) {
			log.event('usage: /autoheal <profile> [threshold=.. stopat=.. self=on|off party=on|off] | off');
			return;
		}
		if (args[0] === 'off') {
			log.event(ctx.session.stopRoutine('autoheal') ? 'autoheal stopped' : 'autoheal was not running');
			return;
		}

		const cfg = ctx.config;
		const key = charKey(cfg);
		const profiles = (cfg.characters && cfg.characters[key] && cfg.characters[key].autoheal) || {};

		const name = args[0];
		const existing = profiles[name] && typeof profiles[name] === 'object' ? profiles[name] : null;
		const profile = { ...DEFAULTS, ...(existing || {}) };

		// Apply key=val overrides.
		for (let i = 1, n = args.length; i < n; ++i) {
			const eq = args[i].indexOf('=');
			if (eq < 0) {
				log.event('bad option "' + args[i] + '" — use key=value (threshold, stopat, self, party)');
				return;
			}
			const field = FIELD_KEYS[args[i].slice(0, eq).toLowerCase()];
			const val = args[i].slice(eq + 1);
			if (!field) {
				log.event('unknown option "' + args[i].slice(0, eq) + '" — threshold, stopat, self, party');
				return;
			}
			if (field === 'threshold' || field === 'stopAt') {
				const f = Number(val);
				if (!Number.isFinite(f) || f <= 0 || f > 1) {
					log.event(field + ' must be a fraction in (0, 1] — e.g. 0.5');
					return;
				}
				profile[field] = f;
			} else {
				const b = parseBool(val);
				if (b == null) {
					log.event(field + ' must be on|off');
					return;
				}
				profile[field] = b;
			}
		}
		if (profile.stopAt < profile.threshold) {
			profile.stopAt = profile.threshold; // hysteresis needs stopAt >= threshold
		}

		// Persist unless we're just launching an unchanged existing profile.
		const unchanged = existing && JSON.stringify(existing) === JSON.stringify(profile);
		if (!unchanged) {
			saveConfig({ characters: { [key]: { autoheal: { [name]: profile } } } });
			log.event(
				'saved autoheal profile "' +
					name +
					'" (heal < ' +
					Math.round(profile.threshold * 100) +
					'% → ' +
					Math.round(profile.stopAt * 100) +
					'%, self ' +
					(profile.self ? 'on' : 'off') +
					', party ' +
					(profile.party ? 'on' : 'off') +
					') for ' +
					key
			);
		}

		const res = ctx.session.startRoutine('autoheal', [name], ctx);
		if (!res.ok) {
			log.event(res.reason);
		}
	}
};
