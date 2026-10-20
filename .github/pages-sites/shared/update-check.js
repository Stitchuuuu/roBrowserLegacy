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

	// Over every game window, under the game cursor (.cursor, z-index 9999).
	const Z_INDEX = 9998;

	// The client's restart button, drawn in CSS until the client's <ui-button> loads its sprites.
	const LOOK_ALIKE =
		'#ro-update .look{box-sizing:border-box;border:1px solid #a9a9a9;border-radius:4px;color:#222;' +
		'font:11px/18px Arial,sans-serif;text-align:center;background:linear-gradient(#e0e0e0,#f7f7f7 80%,#cdcdcd)}' +
		'#ro-update .look:hover{background:linear-gradient(#b7c3db,#acbee0 30%,#ccdaf3 85%,#b7becb)}' +
		'#ro-update .look:active{padding-top:1px}';

	function reloadButton() {
		const button = document.createElement('ui-button');
		button.className = 'look';
		button.textContent = 'restart';
		button.setAttribute('bg', 'btn_restart.bmp');
		button.setAttribute('hover', 'btn_restart_a.bmp');
		button.setAttribute('down', 'btn_restart_b.bmp');
		button.style.cssText = 'display:block;width:42px;height:20px;background-repeat:no-repeat';
		// The client's UI is up: its <ui-button> has set a sprite, the look-alike goes.
		new MutationObserver((records, observer) => {
			if (button.style.backgroundImage) {
				button.className = '';
				button.textContent = '';
				observer.disconnect();
			}
		}).observe(button, { attributeFilter: ['style'] });
		button.addEventListener('click', () => location.reload());
		return button;
	}

	function banner() {
		const style = document.createElement('style');
		style.textContent = LOOK_ALIKE;
		const box = document.createElement('div');
		box.id = 'ro-update';
		box.style.cssText =
			`position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:${Z_INDEX};padding:6px 12px;` +
			'background:#222c;color:#eee;font:14px/1.4 system-ui,sans-serif;border-radius:4px;display:flex;gap:10px;align-items:center';
		box.append(style, 'A new version of the client is out.', reloadButton());
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
