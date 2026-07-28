/**
 * Node/transport/WsSocket.js
 *
 * WebSocket transport for the headless Node client, over the `ws`
 * package. Mirrors the browser contract of
 * src/Network/SocketHelpers/WebSocket.js:16-59 — ctor (host, port, proxy),
 * `connected`, assignable onComplete/onMessage/onClose, send(), close() —
 * including the wsproxy URL rule: url = proxy (trailing '/' ensured)
 * + host + ':' + port.
 *
 * One deliberate deviation from the browser file: `ws` in Node emits
 * 'message' with (data, isBinary) — no browser MessageEvent wrapper —
 * and with binaryType='arraybuffer' the data is already an ArrayBuffer.
 */
import WebSocket from 'ws';
import { log } from '../log.js';

/**
 * Effective WebSocket URL — wsproxy rule of SocketHelpers/WebSocket.js:24-28.
 *
 * @param {string} host
 * @param {number} port
 * @param {?string} proxy wsproxy base URL (ws:// or wss://), or null for direct
 * @returns {string}
 */
export function wsUrl(host, port, proxy) {
	let url = 'ws://' + host + ':' + port + '/';

	if (proxy) {
		url = proxy;
		if (!url.match(/\/$/)) {
			url += '/';
		}
		url += host + ':' + port;
	}

	return url;
}

/**
 * @param {string} host
 * @param {number} port
 * @param {?string} proxy wsproxy base URL (ws:// or wss://), or null for direct
 */
function WsSocket(host, port, proxy) {
	const url = wsUrl(host, port, proxy);
	const self = this;
	this.connected = false;

	log('info', 'ws →', url);
	this.ws = new WebSocket(url);
	this.ws.binaryType = 'arraybuffer';

	this.ws.on('open', function onOpen() {
		self.connected = true;
		self.onComplete(true);
	});

	this.ws.on('error', function onError(err) {
		if (!self.connected) {
			console.error('[WsSocket]', url, err.message);
			self.onComplete(false);
		}
	});

	this.ws.on('message', function onMessage(data) {
		self.onMessage(data);
	});

	this.ws.on('close', function onWsClose() {
		self.connected = false;
		if (self.onClose) {
			self.onClose();
		}
	});
}

/**
 * @param {ArrayBuffer} buffer
 */
WsSocket.prototype.send = function send(buffer) {
	if (this.connected) {
		this.ws.send(buffer);
	}
};

WsSocket.prototype.close = function close() {
	if (this.connected) {
		this.connected = false;
		this.ws.close();
	}
};

/**
 * Factory for Network.setSocketFactory — NetworkManager calls it with
 * (host, port) only (NetworkManager.js:104), so the proxy is captured here.
 *
 * @param {?string} wsProxy
 * @returns {function(string, number): WsSocket}
 */
export function createSocketFactory(wsProxy) {
	return function socketFactory(host, port) {
		return new WsSocket(host, port, wsProxy || null);
	};
}

export default WsSocket;
