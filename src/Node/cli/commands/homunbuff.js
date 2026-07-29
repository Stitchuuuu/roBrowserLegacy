/**
 * /homunbuff <profile> [skills=.. own=on|off party=on|off radius=.. spfloor=..] | status | off
 *
 * Forms:
 *  - /homunbuff off                    → stop the routine (session stays in map).
 *  - /homunbuff status                 → list the homunculi currently tracked, with
 *                                        their cell, attributed owner and distance.
 *  - /homunbuff <profile>              → start a saved profile (or a new one with
 *                                        defaults if it doesn't exist yet).
 *  - /homunbuff <profile> key=val…     → define / update the profile's fields,
 *                                        save, then start it.
 *
 * Fields: skills (comma list), own / party (on|off), radius (cells around an
 * Alchemist party member — no packet links a homunculus to its master, so
 * proximity is the attribution), spfloor (SP to keep in reserve). Per-skill
 * duration overrides are edited directly in config.local.json under the
 * profile's `durations`, since they only matter on a server whose skill_db
 * differs from pre-renewal defaults.
 *
 * Profiles are stored per character
 * (config.characters["<login>/<slot>"].homunbuff[name]) — same multi-config
 * shape as /autobuff and /autoheal.
 */
import { saveConfig, charKey } from '../../config.js';
import { log } from '../../log.js';

const DEFAULTS = { skills: ['blessing', 'incagi'], own: true, party: true, radius: 8, spFloor: 0 };
const FIELD_KEYS = { skills: 'skills', own: 'own', party: 'party', radius: 'radius', spfloor: 'spFloor' };
const OPTION_LIST = 'skills, own, party, radius, spfloor';

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

function cheby(ax, ay, bx, by) {
	const dx = ax > bx ? ax - bx : bx - ax;
	const dy = ay > by ? ay - by : by - ay;
	return dx > dy ? dx : dy;
}

// Read-only view of the tracker — the surface for checking the proximity
// attribution live, before (or without) arming the routine.
function showStatus(ctx) {
	const client = ctx.client;
	const homs = client.homun.list();
	const ownId = client.homun.getOwnId();
	if (!homs.length) {
		log.event('no homunculus in view' + (ownId ? ' (own homun id ' + ownId + ', out of view)' : ''));
		return;
	}
	const player = client.player;
	const known = player.x || player.y;
	for (let i = 0, n = homs.length; i < n; ++i) {
		const hom = homs[i];
		log.event(
			(hom.name || 'homun') +
				' #' +
				hom.gid +
				(hom.gid === ownId ? ' (own)' : '') +
				' @' +
				hom.x +
				',' +
				hom.y +
				' · ' +
				(known ? cheby(player.x, player.y, hom.x, hom.y) + ' cells away' : 'distance unknown') +
				' · near: ' +
				(nearbyMembers(client, hom) || '—')
		);
	}
}

// Party members standing next to this homunculus, closest first — whoever the
// routine would attribute it to (Alchemist-family ones marked).
function nearbyMembers(client, hom) {
	const selfMap = client.currentMap;
	const members = client.party.getMembers();
	const near = [];
	for (let i = 0, n = members.length; i < n; ++i) {
		const m = members[i];
		if (!m.online || (selfMap && m.map !== selfMap) || (!m.x && !m.y)) {
			continue;
		}
		const d = cheby(hom.x, hom.y, m.x, m.y);
		if (d <= 12) {
			near.push({ label: m.name + '(job ' + m.class_ + ', ' + d + ')', d });
		}
	}
	near.sort((a, b) => a.d - b.d);
	return near.map(e => e.label).join(', ');
}

export default {
	name: 'homunbuff',
	aliases: ['hb'],
	usage: '<profile> [skills=.. own=on|off party=on|off radius=.. spfloor=..] | status | off',
	help: 'keep buffs up on a homunculus, on a confirmed timer (named profile)',
	run(ctx, args) {
		if (!args.length) {
			log.event(
				'usage: /homunbuff <profile> [skills=.. own=on|off party=on|off radius=.. spfloor=..] | status | off'
			);
			return;
		}
		if (args[0] === 'off') {
			log.event(ctx.session.stopRoutine('homunbuff') ? 'homunbuff stopped' : 'homunbuff was not running');
			return;
		}
		if (args[0] === 'status') {
			showStatus(ctx);
			return;
		}

		const cfg = ctx.config;
		const key = charKey(cfg);
		const profiles = (cfg.characters && cfg.characters[key] && cfg.characters[key].homunbuff) || {};

		const name = args[0];
		const existing = profiles[name] && typeof profiles[name] === 'object' ? profiles[name] : null;
		const profile = { ...DEFAULTS, ...(existing || {}) };

		// Apply key=val overrides.
		for (let i = 1, n = args.length; i < n; ++i) {
			const eq = args[i].indexOf('=');
			if (eq < 0) {
				log.event('bad option "' + args[i] + '" — use key=value (' + OPTION_LIST + ')');
				return;
			}
			const field = FIELD_KEYS[args[i].slice(0, eq).toLowerCase()];
			const val = args[i].slice(eq + 1);
			if (!field) {
				log.event('unknown option "' + args[i].slice(0, eq) + '" — ' + OPTION_LIST);
				return;
			}
			if (field === 'skills') {
				const list = val
					.split(',')
					.map(s => s.trim())
					.filter(Boolean);
				if (!list.length) {
					log.event('skills must be a comma list — e.g. skills=blessing,incagi,kyrie');
					return;
				}
				profile.skills = list;
			} else if (field === 'radius' || field === 'spFloor') {
				const num = Number(val);
				if (!Number.isFinite(num) || num < 0) {
					log.event(field + ' must be a positive number');
					return;
				}
				profile[field] = num;
			} else {
				const b = parseBool(val);
				if (b == null) {
					log.event(field + ' must be on|off');
					return;
				}
				profile[field] = b;
			}
		}

		// Persist unless we're just launching an unchanged existing profile.
		const unchanged = existing && JSON.stringify(existing) === JSON.stringify(profile);
		if (!unchanged) {
			saveConfig({ characters: { [key]: { homunbuff: { [name]: profile } } } });
			log.event(
				'saved homunbuff profile "' +
					name +
					'" (' +
					profile.skills.join(', ') +
					', own ' +
					(profile.own ? 'on' : 'off') +
					', party ' +
					(profile.party ? 'on' : 'off') +
					', radius ' +
					profile.radius +
					') for ' +
					key
			);
		}

		const res = ctx.session.startRoutine('homunbuff', [name], ctx);
		if (!res.ok) {
			log.event(res.reason);
		}
	}
};
