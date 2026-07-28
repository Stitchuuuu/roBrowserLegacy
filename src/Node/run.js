/**
 * Node/run.js
 *
 * Headless connect entry: boots the clip-in layer, runs the
 * login → char → map handshake against config.local.json, then stays
 * alive on the ping loop until Ctrl-C.
 *
 * Run via `npm run connect:node` — ./shim.js must be preloaded with
 * `node --import` (see shim.js header), it is NOT imported here.
 */
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
import { boot } from './boot.js';
import { resolvePassword } from './config.js';
import { observePacket, observePacketStatus } from './net/observe.js';
import { runSession } from './net/session.js';
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
	password = await resolvePassword();
} catch (err) {
	log('error', err.message);
	process.exit(1);
}

// Additive-listener check, alongside the handshake's own hookPacket use:
// both must see the login-accept packet.
function onObservedLogin() {
	log('info', 'observePacket: login-accept observed ✔');
}
observePacket(PACKET.AC.ACCEPT_LOGIN, onObservedLogin);
observePacket(PACKET.AC.ACCEPT_LOGIN3, onObservedLogin);

// Clean quit: ask the map server to log us out (CZ.REQ_DISCONNECT →
// ZC.ACK_REQ_DISCONNECT) before closing, so the char doesn't linger
// server-side ("server still recognizes your last log-in" on relaunch).
// 1 s fallback mirrors the engine's exit flow (MapEngine.js:777-785).
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

runSession(cfg, password)
	.then(result => {
		log('info', 'CONNECTED — in map', result.mapName);
		log('info', 'observer status:', JSON.stringify(observePacketStatus()));
	})
	.catch(err => {
		log('error', err.message);
		process.exit(err.exitCode || 1);
	});
