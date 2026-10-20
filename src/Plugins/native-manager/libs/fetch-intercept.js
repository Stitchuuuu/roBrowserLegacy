/**
 * Plugins/native-manager/libs/fetch-intercept.js
 *
 * Page-side fetch middleware API, served to plugins as `deps.libs['fetch-intercept']`
 *
 * A middleware is `async (req, next) => Response | undefined`. It runs on the page and, rebuilt from its
 * source, in the asset worker: no closure crosses over, state goes through `config` / `self.__RO_config`.
 * Active only when ROConfig.fetchIntercept made the native manager start the asset worker.
 */

import { runChain } from 'Plugins/native-manager/asset-worker-core.js';

/**
 * @var {Worker|null} asset worker, set by the native manager
 */
let _worker = null;

/**
 * @var {number} last middleware id
 */
let _seq = 0;

/**
 * @var {function|null} window.fetch before the page chain was installed
 */
let _origFetch = null;

/**
 * Page-side middleware list
 * @var {Array<function>}
 */
const _list = [];

/**
 * Messages posted before the worker exists
 * @var {Array<object>}
 */
const _pending = [];

/**
 * onWorkerReady callbacks waiting for the worker
 * @var {Array<function>}
 */
const _readyCallbacks = [];

/**
 * @var {object} last stats posted by the worker
 */
let _workerStats = { hits: 0, misses: 0, bytes: 0 };

/**
 * Post a message to the worker, or queue it
 *
 * @param {object} msg
 */
function post(msg) {
	if (_worker) {
		_worker.postMessage(msg);
	} else {
		_pending.push(msg);
	}
}

/**
 * Track the worker's stats and failed registrations
 *
 * @param {MessageEvent} event
 */
function onWorkerMessage(event) {
	const msg = event.data;
	if (!msg) {
		return;
	}

	if (msg.type === '__RO_intercept_stats') {
		_workerStats = { hits: msg.hits, misses: msg.misses, bytes: msg.bytes };
	} else if (msg.type === '__RO_intercept_registered' && !msg.ok) {
		console.error('[fetch-intercept] worker rejected middleware ' + msg.id + ': ' + msg.error);
	}
}

/**
 * Hand the asset worker to the lib: enables it, flushes queued messages and ready callbacks
 * Called by the native manager only
 *
 * @param {Worker} assetWorker
 */
export function attachWorker(assetWorker) {
	_worker = assetWorker;
	assetWorker.addEventListener('message', onWorkerMessage);

	for (let i = 0; i < _pending.length; ++i) {
		assetWorker.postMessage(_pending[i]);
	}
	_pending.length = 0;

	const callbacks = _readyCallbacks.splice(0);
	for (let i = 0; i < callbacks.length; ++i) {
		callbacks[i](assetWorker);
	}
}

/**
 * Whether the server enabled fetch interception
 *
 * @return {boolean}
 */
function enabled() {
	return _worker !== null;
}

/**
 * Register a middleware on the page and in the asset worker
 *
 * @param {function} fn - `async (req, next) => Response | undefined`, serialisable with toString()
 * @param {object} [config] - merged into the worker's `self.__RO_config` before `fn` is rebuilt
 * @return {{id: number, fn: function, config: object}} handle for unregister()
 */
function register(fn, config = {}) {
	if (!enabled()) {
		throw new Error('fetchIntercept disabled by server config');
	}

	if (!_origFetch) {
		_origFetch = window.fetch.bind(window);
		window.fetch = (input, init) => runChain(_list, new Request(input, init), _origFetch);
	}

	const id = ++_seq;
	_list.push(fn);
	post({ type: '__RO_intercept_register', id, config, code: fn.toString() });

	return { id, fn, config };
}

/**
 * Remove a middleware registered with register()
 *
 * @param {{id: number, fn: function}} handle
 */
function unregister(handle) {
	const index = _list.indexOf(handle.fn);
	if (index >= 0) {
		_list.splice(index, 1);
	}

	post({ type: '__RO_intercept_unregister', id: handle.id });
}

/**
 * Merge settings into the page and worker `__RO_config`
 *
 * @param {object} cfg
 */
function setConfig(cfg) {
	window.__RO_config = Object.assign(window.__RO_config || {}, cfg);
	post({ type: '__RO_setConfig', config: cfg });
}

/**
 * Call back with the asset worker once it exists
 *
 * @param {function} callback - receives the Worker
 */
function onWorkerReady(callback) {
	if (_worker) {
		callback(_worker);
	} else {
		_readyCallbacks.push(callback);
	}
}

/**
 * @return {Worker|null}
 */
function worker() {
	return _worker;
}

/**
 * @return {boolean}
 */
function workerAvailable() {
	return _worker !== null;
}

/**
 * Hit / miss counters: `worker` is the last 3 s report, `main` is kept for the userscript API shape
 *
 * @return {{main: object, worker: object}}
 */
function stats() {
	return { main: { hits: 0, misses: 0, bytes: 0 }, worker: { ..._workerStats } };
}

/**
 * Public API given to plugins
 */
export const fetchIntercept = Object.freeze({
	register,
	unregister,
	setConfig,
	worker,
	onWorkerReady,
	workerAvailable,
	stats,
	enabled
});
