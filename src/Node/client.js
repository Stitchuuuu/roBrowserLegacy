/**
 * Node/client.js
 *
 * Façade entry: boots the clip-in layer, connects via RoClient, wires event
 * loggers, then runs a one-shot verify sequence (skill list, party roster,
 * a self-target cast emission) and stays alive on the ping loop until
 * Ctrl-C. Session-2 verification harness for the state + façade layer.
 *
 * Run via `npm run client:node` — ./shim.js must be preloaded with
 * `node --import` (see shim.js header), it is NOT imported here.
 */
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import Session from 'Engine/SessionStorage.js';
import { boot } from './boot.js';
import { resolvePassword } from './config.js';
import { RoClient } from './api/RoClient.js';
import { wsUrl } from './transport/WsSocket.js';
import { log } from './log.js';

let cfg;
let password;
try {
	cfg = boot();
	log(
		'info',
		'target :',
		wsUrl(cfg.server.host, cfg.server.port, cfg.server.wsProxy),
		'· packetver',
		cfg.server.packetver
	);
	log('info', 'account:', cfg.account.login);
	password = await resolvePassword(cfg);
} catch (err) {
	log('error', err.message);
	process.exit(1);
}

const client = new RoClient(cfg);

client.on('hp', e => log('info', 'hp', e.hp + '/' + e.maxhp));
client.on('sp', e => log('info', 'sp', e.sp + '/' + e.maxsp));
client.on('change', e => log('info', 'player', e.field, '=', e.field === 'stats' ? '(block)' : e.value));
client.on('status', e =>
	log(
		'info',
		'status',
		'aid',
		e.aid,
		'efst',
		e.efst,
		e.active ? 'ON' : 'off',
		e.active && e.end ? '(' + Math.max(0, e.end - Date.now()) + 'ms left)' : ''
	)
);
client.on('party', e => log('info', 'party event:', e.reason));
client.on('chat', e => log('info', 'chat:', e.msg));
client.on('privateMessage', e => log('info', 'whisper from', e.sender + ':', e.msg));
client.on('cast', e =>
	log('info', 'CAST — SKID', e.skid, e.name, 'lv' + e.level, '→', e.target, '(' + e.targetKind + ')')
);
client.on('blocked', e => log('warn', 'cast blocked —', e.reason));
client.on('disconnected', () => log('warn', 'client disconnected'));

// Clean quit: ask the map server to log us out before closing (mirrors
// run.js — avoids the server "still recognizes your last log-in" lingering).
let quitting = false;
process.on('SIGINT', () => {
	if (quitting) {
		process.exit(130);
	}
	quitting = true;
	log('info', 'SIGINT — requesting clean disconnect (Ctrl-C again to force)');

	Network.onDisconnect = function onQuitClose() {
		process.exit(0);
	};

	try {
		Network.hookPacket(PACKET.ZC.ACK_REQ_DISCONNECT, pkt => {
			if (pkt.result !== 0) {
				log('warn', 'server delayed the disconnect (result ' + pkt.result + ') — closing anyway');
			}
			Network.close();
			process.exit(0);
		});
		const pkt = new PACKET.CZ.REQ_DISCONNECT();
		pkt.type = 0;
		Network.sendPacket(pkt);
	} catch {
		// not connected yet — plain close below
	}

	setTimeout(() => {
		Network.close();
		process.exit(0);
	}, 1000);
});

/**
 * One-shot façade probe once the initial state packets have settled
 * (SKILLINFO_LIST2 / GROUP_LIST arrive right after map entry).
 */
function runVerify() {
	const skills = client.getSkills();
	log('info', 'getSkills() →', skills.length, 'skill(s)');
	const shown = Math.min(skills.length, 40);
	for (let i = 0; i < shown; ++i) {
		const s = skills[i];
		log('info', '  SKID', s.skid, s.name, 'lv' + s.level, 'sp' + s.spcost);
	}
	if (skills.length > shown) {
		log('info', '  …', skills.length - shown, 'more');
	}

	const party = client.getParty();
	log('info', 'getParty() →', party.length, 'member(s)' + (party.length ? '' : ' (no party — empty path)'));
	for (let i = 0, n = party.length; i < n; ++i) {
		const m = party[i];
		log(
			'info',
			'  ',
			m.name,
			'aid',
			m.aid,
			'gid',
			m.gid,
			'hp',
			m.hp + '/' + m.maxhp,
			m.online ? 'online' : 'offline'
		);
	}

	log('info', 'doSkill(increaseagi, me) — emission proof (self GID', Session.GID + '):');
	const res = client.doSkill('increaseagi', 'me');
	log('info', '  result:', JSON.stringify(res));
}

client
	.connect(password)
	.then(result => {
		log('info', 'CONNECTED — in map', result.mapName);
		setTimeout(runVerify, 1500);
	})
	.catch(err => {
		log('error', err.message);
		process.exit(err.exitCode || 1);
	});
