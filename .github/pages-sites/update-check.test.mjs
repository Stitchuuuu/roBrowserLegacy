// A deployed client reaches the player: shared/sw.js revalidates with the server, assemble.sh stamps
// version.json, shared/update-check.js (run in a vm) shows the banner when the stamp changes.
//   node --test .github/pages-sites/update-check.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const HERE = new URL('.', import.meta.url);
const read = path => readFileSync(new URL(path, HERE), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function serviceWorker(fetch) {
	const listeners = {};
	const store = new Map();
	const cache = {
		put: async (request, response) => store.set(request.url, response),
		match: async request => store.get(request.url)
	};
	runInNewContext(read('shared/sw.js'), {
		self: { location: { origin: 'https://site.test' }, addEventListener: (type, fn) => (listeners[type] = fn) },
		importScripts() {},
		caches: { open: async () => cache },
		fetch,
		AbortSignal,
		URL,
		Date
	});
	return async url => {
		let reply;
		listeners.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith: p => (reply = p) });
		return reply;
	};
}

test('the service worker revalidates with the server instead of trusting the HTTP cache', async () => {
	const calls = [];
	const request = serviceWorker(async (req, init) => {
		calls.push(init.cache);
		return { ok: true, clone: () => ({ body: 'new' }) };
	});
	await request('https://site.test/cyro.live/Online.js.enc');
	assert.deepEqual(calls, ['no-cache']);
});

test('the service worker still answers from its copy when the server is down', async () => {
	let up = true;
	const request = serviceWorker(async () => {
		if (!up) {
			throw new TypeError('offline');
		}
		return { ok: true, body: 'v1', clone: () => ({ body: 'v1' }) };
	});
	await request('https://site.test/cyro.live/api.js');
	up = false;
	assert.equal((await request('https://site.test/cyro.live/api.js')).body, 'v1');
});

function page(hashes) {
	const appended = [];
	const listeners = {};
	let tick = null;
	const element = tag => ({
		tag,
		style: {},
		children: [],
		attributes: {},
		append(...nodes) {
			this.children.push(...nodes);
		},
		setAttribute(name, value) {
			this.attributes[name] = value;
		},
		addEventListener(type, fn) {
			this[`on${type}`] = fn;
		},
		remove() {
			appended.splice(appended.indexOf(this), 1);
		}
	});
	const document = {
		visibilityState: 'visible',
		createElement: element,
		body: { append: el => appended.push(el) },
		addEventListener: (type, fn) => (listeners[type] = fn)
	};
	runInNewContext(read('shared/update-check.js'), {
		fetch: async (url, init) => {
			assert.equal(url, 'version.json');
			assert.equal(init.cache, 'no-store');
			return { ok: true, json: async () => ({ hash: hashes.shift() }) };
		},
		setInterval: fn => (tick = fn),
		document,
		location: { reload() {} },
		MutationObserver: class {
			observe() {}
		}
	});
	return { appended, tick: () => tick(), visible: () => listeners.visibilitychange() };
}

test('no banner while the deployed client is the one loaded', async () => {
	const { appended, tick } = page(['a', 'a', 'a']);
	await flush();
	tick();
	await flush();
	tick();
	await flush();
	assert.equal(appended.length, 0);
});

test('a banner, once, when a new client is deployed', async () => {
	const { appended, tick, visible } = page(['a', 'b', 'c']);
	await flush();
	tick();
	await flush();
	assert.equal(appended.length, 1);
	assert.equal(appended[0].id, 'ro-update');
	visible();
	await flush();
	assert.equal(appended.length, 1);
});

test('the banner stays under the game cursor, with the client restart button', async () => {
	const { appended, tick } = page(['a', 'b']);
	await flush();
	tick();
	await flush();
	const box = appended[0];
	assert.ok(Number(/z-index:(\d+)/.exec(box.style.cssText)[1]) < 9999);
	const button = box.children.find(node => node.tag === 'ui-button');
	assert.deepEqual(button.attributes, {
		bg: 'btn_restart.bmp',
		hover: 'btn_restart_a.bmp',
		down: 'btn_restart_b.bmp'
	});
});

test('the window-close button takes the banner away, until the next page load', async () => {
	const { appended, tick, visible } = page(['a', 'b', 'c']);
	await flush();
	tick();
	await flush();
	const close = appended[0].children.find(node => node.attributes?.bg === 'basic_interface/sys_close_off.bmp');
	assert.equal(close.attributes.hover, 'basic_interface/sys_close_on.bmp');
	close.onclick();
	assert.equal(appended.length, 0);
	visible();
	await flush();
	assert.equal(appended.length, 0);
});

test('coming back to the tab checks again', async () => {
	const { appended, visible } = page(['a', 'b']);
	await flush();
	visible();
	await flush();
	assert.equal(appended.length, 1);
});

test('assemble.sh stamps the client hash and the build commit in version.json', () => {
	const root = mkdtempSync(join(tmpdir(), 'pages-'));
	const dir = name => {
		mkdirSync(join(root, name));
		return join(root, name);
	};
	const built = dir('built');
	const plugins = dir('plugins');
	const site = dir('site');
	writeFileSync(join(built, 'api.html'), '<html></html>');
	writeFileSync(join(built, 'Online.js'), 'console.log(1);');
	writeFileSync(join(built, 'build.json'), '{"sha":"6e2c73ef"}');
	writeFileSync(join(site, 'Config.local.js'), '');
	const out = join(root, 'out');
	execFileSync('bash', [new URL('assemble.sh', HERE).pathname, built, plugins, site, out]);
	const hash = createHash('sha256').update('console.log(1);').digest('hex');
	assert.deepEqual(JSON.parse(readFileSync(join(out, 'version.json'), 'utf8')), { hash, sha: '6e2c73ef' });
});
