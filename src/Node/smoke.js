/**
 * Node/smoke.js
 *
 * Build smoke check — no server, no config.local.json needed. Proves the
 * whole Network module graph loads under plain node (window shim OK,
 * Configs IIFE OK, PacketStructure RENEWAL const OK, packet registration
 * ran) by reading a registered packet id.
 *
 * Run via `npm run smoke:node` — ./shim.js must be preloaded with
 * `node --import` (see shim.js header), it is NOT imported here.
 */
import process from 'node:process';
import Network from 'Network/NetworkManager.js';
import PACKET from 'Network/PacketStructure.js';

const id = Number(PACKET.CZ.USE_SKILL2.id);
const ok = id === 0x438 && typeof Network.sendPacket === 'function';

console.log('[smoke] CZ.USE_SKILL2.id =', id, '(expect 1080 / 0x438) —', ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
