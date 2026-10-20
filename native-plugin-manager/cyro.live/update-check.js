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

	// The client's restart and window-close buttons; .look draws them in CSS until the client's
	// <ui-button> loads its sprites.
	const STYLE =
		'#ro-update ui-button{display:block;background-repeat:no-repeat}' +
		'#ro-update .restart{width:42px;height:20px}#ro-update .close{width:11px;height:11px}' +
		'#ro-update .look{box-sizing:border-box;border:1px solid #a9a9a9;border-radius:4px;color:#222;' +
		'font:11px/18px Arial,sans-serif;text-align:center;background:linear-gradient(#e0e0e0,#f7f7f7 80%,#cdcdcd)}' +
		'#ro-update .look:hover{background:linear-gradient(#b7c3db,#acbee0 30%,#ccdaf3 85%,#b7becb)}' +
		'#ro-update .look:active{padding-top:1px}' +
		'#ro-update .look.close{border-color:#294379;border-radius:50%;color:#dfe7f6;font:bold 9px/9px Arial,sans-serif;' +
		'background:radial-gradient(circle at 50% 30%,#6589d3,#3f6cc7 60%,#294379)}' +
		'#ro-update .look.close:hover{color:#fff;background:radial-gradient(circle at 50% 30%,#74a6fd,#5896fe 60%,#335693)}' +
		'#ro-update .look.close:active{padding-top:0}';

	function spriteButton(name, label, sprites, onClick) {
		const button = document.createElement('ui-button');
		button.className = `${name} look`;
		button.textContent = label;
		for (const state in sprites) {
			button.setAttribute(state, sprites[state]);
		}
		// The client's UI is up: its <ui-button> has set a sprite, the look-alike goes.
		new MutationObserver((records, observer) => {
			if (button.style.backgroundImage) {
				button.className = name;
				button.textContent = '';
				observer.disconnect();
			}
		}).observe(button, { attributeFilter: ['style'] });
		button.addEventListener('click', onClick);
		return button;
	}

	function banner() {
		const style = document.createElement('style');
		style.textContent = STYLE;
		const box = document.createElement('div');
		box.id = 'ro-update';
		box.style.cssText =
			`position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:${Z_INDEX};padding:6px 12px;` +
			'background:#222c;color:#eee;font:14px/1.4 system-ui,sans-serif;border-radius:4px;display:flex;gap:10px;align-items:center';
		const reload = spriteButton(
			'restart',
			'restart',
			{ bg: 'btn_restart.bmp', hover: 'btn_restart_a.bmp', down: 'btn_restart_b.bmp' },
			() => location.reload()
		);
		// Closed, it stays closed until the next page load.
		const close = spriteButton(
			'close',
			'×',
			{ bg: 'basic_interface/sys_close_off.bmp', hover: 'basic_interface/sys_close_on.bmp' },
			() => box.remove()
		);
		box.append(style, 'A new version of the client is out.', reload, close);
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
