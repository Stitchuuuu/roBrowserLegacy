/**
 * Node/boot.js
 *
 * Runtime wiring for the headless client. Import order matters: the
 * entry must import ./shim.js BEFORE this module so window.ROConfig is
 * populated when the core modules below evaluate (see shim.js header).
 */
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKETVER from 'Network/PacketVerManager.js';
import Configs from 'Core/Configs.js';
import Session from 'Engine/SessionStorage.js';
import { loadConfig } from './config.js';
import { createSocketFactory } from './transport/WsSocket.js';
import { log } from './log.js';

/**
 * @returns {{server: object, account: {login: string}}} the loaded config
 */
export function boot() {
	const cfg = loadConfig();
	const server = cfg.server;

	// shim.js already fed window.ROConfig into Configs' globals; setServer
	// mirrors what LoginEngine does after server selection so
	// Configs.get() resolves server-scoped keys (packetKeys, packetver...).
	Configs.setServer({
		display: 'headless',
		address: server.host,
		port: server.port,
		version: server.version,
		langtype: server.langtype,
		packetver: server.packetver,
		renewal: server.renewal,
		packetKeys: server.packetKeys,
		packetDump: server.packetDump
	});

	// Setter triggers PacketLength.init() (PacketVerManager.js:316-320).
	PACKETVER.value = server.packetver;

	Session.LangType = server.langtype;

	Network.setSocketFactory(createSocketFactory(server.wsProxy));

	// Without this, NetworkManager's onClose falls back to a dynamic
	// import('UI/UIManager.js') — the one UI coupling on the headless path.
	Network.onDisconnect = function onDisconnect() {
		log('warn', 'disconnected from server');
		process.exit(3);
	};

	return cfg;
}
