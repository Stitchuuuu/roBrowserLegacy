/**
 * Plugins/native-manager/asset-worker-core.js
 *
 * Fetch middleware chain and FileSystem mask for the asset worker, scope-injected so tests run without a worker
 */

/**
 * Stats post period
 * @var {number}
 */
const STATS_INTERVAL_MS = 3000;

/**
 * Sync FileSystem entry points read by Core/FileSystem.js
 * @var {Array<string>}
 */
const FS_APIS = ['requestFileSystemSync', 'webkitRequestFileSystemSync'];

/**
 * Run a request through a middleware list
 * A middleware returns a Response to answer, undefined to fall through, or awaits next() to wrap
 *
 * @param {Array<function>} list
 * @param {Request} req
 * @param {function} origFetch - called once, when the list is exhausted
 * @return {Promise<Response>}
 */
export function runChain(list, req, origFetch) {
	let i = 0;
	const next = async () => {
		if (i >= list.length) {
			return origFetch(req);
		}
		const res = await list[i++](req, next);
		return res === undefined ? next() : res;
	};
	return next();
}

/**
 * Rebuild a middleware from its source, with `self` and `config` in scope
 *
 * @param {object} scope
 * @param {string} code - function source
 * @param {object} config
 * @return {function}
 */
export function buildMiddleware(scope, code, config) {
	// eslint-disable-next-line no-new-func -- middleware crosses to the worker as source text
	return new Function('self', 'config', 'return (' + code + ')')(scope, config);
}

/**
 * Install the middleware chain and its message protocol on a worker scope
 *
 * @param {object} scope - worker global scope
 */
export function installShim(scope) {
	const list = [];
	const origFetch = scope.fetch.bind(scope);
	let hits = 0;
	let misses = 0;
	let bytes = 0;

	scope.fetch = (input, init) => runChain(list, new Request(input, init), origFetch);
	scope.__RO_cacheActive = false;

	scope.__RO_recordHit = (b = 0) => {
		hits++;
		bytes += b;
	};
	scope.__RO_recordMiss = (b = 0) => {
		misses++;
		bytes += b;
	};

	// Coexists with ThreadEventHandler's `onmessage =`
	scope.addEventListener('message', event => {
		const msg = event.data;
		if (!msg || typeof msg.type !== 'string') {
			return;
		}

		switch (msg.type) {
			case '__RO_intercept_register':
				try {
					// Merged first so the middleware sees its settings on its first request
					if (msg.config) {
						scope.__RO_config = Object.assign(scope.__RO_config || {}, msg.config);
					}
					const fn = buildMiddleware(scope, msg.code, msg.config || {});
					fn.__id = msg.id;
					list.push(fn);
					scope.__RO_cacheActive = true;
					scope.postMessage({ type: '__RO_intercept_registered', id: msg.id, ok: true });
				} catch (err) {
					scope.postMessage({ type: '__RO_intercept_registered', id: msg.id, ok: false, error: String(err) });
				}
				break;

			case '__RO_intercept_unregister': {
				const index = list.findIndex(fn => fn.__id === msg.id);
				if (index >= 0) {
					list.splice(index, 1);
				}
				scope.__RO_cacheActive = list.length > 0;
				break;
			}

			case '__RO_setConfig':
				scope.__RO_config = Object.assign(scope.__RO_config || {}, msg.config);
				break;
		}
	});

	setInterval(() => {
		scope.postMessage({ type: '__RO_intercept_stats', hits, misses, bytes });
	}, STATS_INTERVAL_MS);
}

/**
 * Whether the worker name asks for the FileSystem cache to be skipped
 *
 * @param {string} name
 * @return {boolean}
 */
export function isNoFs(name) {
	return String(name).includes('nofs');
}

/**
 * Own descriptors replaced by maskFileSystem(), by API name (undefined: the API was inherited or absent)
 * @var {object|null}
 */
let _masked = null;

/**
 * Hide the sync FileSystem API behind own undefined properties
 *
 * @param {object} scope
 */
export function maskFileSystem(scope) {
	_masked = {};
	for (let i = 0; i < FS_APIS.length; ++i) {
		// Browsers expose it as an own property of the worker global: keep it to put back
		_masked[FS_APIS[i]] = Object.getOwnPropertyDescriptor(scope, FS_APIS[i]);
		Object.defineProperty(scope, FS_APIS[i], { value: undefined, configurable: true, writable: true });
	}
}

/**
 * Remove the mask, exposing the original API again
 *
 * @param {object} scope
 */
export function unmaskFileSystem(scope) {
	if (!_masked) {
		return;
	}
	for (let i = 0; i < FS_APIS.length; ++i) {
		const descriptor = _masked[FS_APIS[i]];
		if (descriptor) {
			Object.defineProperty(scope, FS_APIS[i], descriptor);
		} else {
			delete scope[FS_APIS[i]];
		}
	}
	_masked = null;
}
