/**
 * Node/transport/TcpSocket.js
 *
 * Placeholder for a raw-TCP transport (node:net Socket) — not implemented.
 * Contract will mirror WsSocket.js: ctor(host, port), connected,
 * onComplete/onMessage/onClose, send(), close().
 */
export default function TcpSocket() {
	throw new Error('TcpSocket not implemented — use the ws transport (config.server.wsProxy)');
}
