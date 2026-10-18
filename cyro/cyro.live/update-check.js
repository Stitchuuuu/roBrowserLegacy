// Tells the player a newer client is deployed. version.json (written by assemble.sh: the hash of the
// client, and its commit when the build gives one) is read when the page opens, then every CHECK_EVERY
// and when the tab comes back; a different hash shows a banner with a reload button. It never reloads
// by itself: a reload ends the game in progress. The button reloads normally, through the service
// worker, which gate.js needs (a forced reload bypasses it).
(() => {
	const CHECK_EVERY = 5 * 60 * 1000;
	let loaded = null;
	let shown = false;

	async function deployed() {
		try {
			const res = await fetch('version.json', { cache: 'no-store' });
			return res.ok ? (await res.json()).hash || null : null;
		} catch {
			return null;
		}
	}

	function banner() {
		const box = document.createElement('div');
		box.id = 'ro-update';
		box.style.cssText =
			'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:6px 12px;' +
			'background:#222c;color:#eee;font:14px/1.4 system-ui,sans-serif;border-radius:4px;display:flex;gap:10px;align-items:center';
		const reload = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reload' });
		reload.addEventListener('click', () => location.reload());
		box.append('A new version of the client is out.', reload);
		document.body.append(box);
	}

	async function check() {
		const hash = await deployed();
		if (!hash || shown) {
			return;
		}
		if (!loaded) {
			loaded = hash;
		} else if (hash !== loaded) {
			shown = true;
			banner();
		}
	}

	check();
	setInterval(check, CHECK_EVERY);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			check();
		}
	});
})();
