/**
 * Node/shim.js
 *
 * Browser-globals shim. MUST fully execute before ANY bundled core module:
 * it is loaded as a Node preload — `node --import ./src/Node/shim.js
 * dist-node/<entry>.js` (see the *:node npm scripts) — NOT imported by the
 * entries. A plain first-import is not reliable here: the bundler emits
 * shared chunks whose cross-chunk execution order does not always follow
 * source import order. Several core modules dereference `window` at
 * module-load time, before boot() can run —
 *  - Utils/BinaryReader.js:24  `typeof self !== 'undefined' ? self : window`
 *  - Core/Configs.js:70-81     IIFE copying `window.ROConfig` into its globals
 *  - Network/PacketStructure.js:21  `const RENEWAL = Configs.get('renewal')`
 *    frozen at import time (renewal must be correct HERE, not at boot()).
 *
 * Imports ./config.js only (node builtins) — importing any core module
 * from here would defeat the whole point.
 */
import { loadConfig } from './config.js';

const cfg = loadConfig({ allowMissing: true });
const server = cfg.server;

globalThis.window = globalThis;
if (typeof globalThis.self === 'undefined') {
	globalThis.self = globalThis;
}

globalThis.ROConfig = {
	renewal: server.renewal,
	packetver: server.packetver,
	packetKeys: server.packetKeys,
	packetDump: server.packetDump,
	socketProxy: server.wsProxy,
	servers: [
		{
			display: 'headless',
			address: server.host,
			port: server.port,
			version: server.version,
			langtype: server.langtype,
			packetver: server.packetver
		}
	]
};
