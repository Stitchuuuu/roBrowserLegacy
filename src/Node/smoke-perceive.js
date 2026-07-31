/**
 * Node/smoke-perceive.js
 *
 * Session-1 (node-farm-macros) verification harness: connects via the normal
 * handshake, logs every perception event live, and periodically dumps
 * entities / inventory / storage / current NPC dialog so each of the four
 * jalon-1 trackers can be eyeballed against a live cyro session. Needs a
 * live server — this is a manual, host-run check (see
 * plans/node-farm-macros/TEST-PLAN-1.md), not part of `npm run node:smoke`
 * (which asserts the build graph loads, no server).
 *
 * Run via `npm run node:perceive` — ./shim.js must be preloaded with
 * `node --import` (see shim.js header), it is NOT imported here.
 */
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';
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

client.on('entity', e => log('info', 'entity', e.reason, 'gid', e.gid, 'type', e.objecttype));
client.on('inventory', e => log('info', 'inventory', e.reason, e.index != null ? 'index ' + e.index : ''));
client.on('storage', e => log('info', 'storage', e.reason, e.index != null ? 'index ' + e.index : ''));
client.on('dialog', e => log('info', 'dialog', e.awaiting, e.naid, JSON.stringify(e.text || e.options)));
client.on('privateMessage', e => log('info', 'whisper from', e.sender + ':', e.msg));
client.on('disconnected', () => log('warn', 'client disconnected'));

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

function dump() {
	const entities = client.entities.list();
	log('info', 'entities.list() →', entities.length, 'unit(s)');
	for (let i = 0, n = Math.min(entities.length, 20); i < n; ++i) {
		const e = entities[i];
		log('info', '  ', e.gid, e.name, '(' + e.x + ',' + e.y + ')', 'type', e.objecttype, 'job', e.job);
	}

	const items = client.inventory.list();
	log('info', 'inventory.list() →', items.length, 'slot(s)');
	for (let i = 0, n = Math.min(items.length, 20); i < n; ++i) {
		const it = items[i];
		log('info', '  ', it.index, 'ITID', it.itid, 'x' + it.count);
	}

	const stored = client.storage.list();
	log('info', 'storage.isOpen() →', client.storage.isOpen(), '· list() →', stored.length, 'slot(s)');
	for (let i = 0, n = Math.min(stored.length, 20); i < n; ++i) {
		const it = stored[i];
		log('info', '  ', it.index, 'ITID', it.itid, 'x' + it.count);
	}

	const dialog = client.npc.get();
	log('info', 'npc.get() →', JSON.stringify(dialog));
}

client
	.connect(password)
	.then(result => {
		log('info', 'CONNECTED — in map', result.mapName);
		setInterval(dump, 5000);
	})
	.catch(err => {
		log('error', err.message);
		process.exit(err.exitCode || 1);
	});
