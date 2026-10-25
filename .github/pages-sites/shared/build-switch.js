// The switch between the client builds of this server, top right of the login screen: beta (upstream),
// the cyro.live build, and NPM on its own page or once an access key is kept (access-key.js). Half
// see-through with each build's date, it turns opaque as the pointer comes near; hovering a build tells
// what it is, its update and the upstream commit it is based on, linked (its version.json, written by
// assemble.sh). It goes with the login window: switching loads another client, which would end a game.
(() => {
	// [label, what it is]
	const BUILDS = {
		upstream: ['beta', 'The open-source roBrowser client, as upstream ships it.'],
		cyro: ['cyro.live build', 'The version CyRO serves right now.'],
		'native-plugin-manager': ['NPM', 'roBrowser with the native plugin manager, for access key holders.']
	};
	// Where the commits are: the builds' branches, and upstream's master
	const REPO = 'https://github.com/Stitchuuuu/roBrowserLegacy';
	const UPSTREAM = 'https://github.com/MrAntares/roBrowserLegacy';
	// The login window of every client version, a child of <body>
	const LOGIN = ['WinLogin', 'WinLoginV2'];

	// Over every game window, under the game cursor (.cursor, z-index 9999), like update-check.js.
	const Z_INDEX = 9998;

	const STYLE =
		// The padding is the approach zone: the switch lights up before the pointer reaches it
		`#ro-builds{position:fixed;top:0;right:0;z-index:${Z_INDEX};padding:10px 10px 48px 64px;text-align:right;` +
		'font:13px/1.3 system-ui,sans-serif;color:#eee}' +
		'#ro-builds[hidden]{display:none}' +
		'#ro-builds .switch{display:inline-flex;gap:3px;padding:3px;background:#222c;border:1px solid #fff3;' +
		'border-radius:8px;opacity:.55;transition:opacity .25s ease}' +
		'#ro-builds .switch a{display:grid;padding:4px 10px;border-radius:5px;color:#bbb;text-align:center;' +
		'text-decoration:none}' +
		'#ro-builds .switch a:hover,#ro-builds .switch a:focus-visible{color:#fff}' +
		'#ro-builds .switch a[aria-current]{background:#eee;color:#222}' +
		'#ro-builds .date{font-size:10px;opacity:.8}' +
		'#ro-builds .tip{max-width:24em;max-height:0;margin:6px 0 0 auto;padding:0 8px;overflow:hidden;opacity:0;' +
		'background:#222c;border-radius:5px;font-size:12px;line-height:1.4;' +
		'transition:max-height .25s ease,opacity .25s ease}' +
		'#ro-builds .tip span{display:block}#ro-builds .tip span:first-child{padding-top:5px}' +
		'#ro-builds .tip span:last-child{padding-bottom:5px}' +
		'#ro-builds .tip span+span{color:#bbb;white-space:nowrap}#ro-builds .tip a{color:inherit}' +
		'#ro-builds:hover .switch,#ro-builds:focus-within .switch{opacity:1}' +
		'#ro-builds:hover .tip,#ro-builds:focus-within .tip{max-height:8em;opacity:1}' +
		'@media (hover:none){#ro-builds .switch{opacity:1}}' +
		'@media (prefers-reduced-motion:reduce){#ro-builds .switch,#ro-builds .tip{transition:none}}';

	// /<build>/<site>/api.html; the site at the root (/<site>/) has no switch
	const path = location.pathname.split('/');
	const site = path[path.length - 2];
	const build = path[path.length - 3];
	if (!site || !BUILDS[build]) {
		return;
	}
	const root = path.slice(0, -3).join('/');

	function day(date) {
		return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	// cyro/ is the client the server serves: the site's config version is that client's build time
	const config = window.ROConfigLocal;
	const served = config && config.version ? day(config.version * 1000) : null;

	function init() {
		const style = document.createElement('style');
		style.textContent = STYLE;
		const nav = document.createElement('nav');
		nav.id = 'ro-builds';
		nav.setAttribute('aria-label', 'Client build');
		const box = document.createElement('div');
		box.className = 'switch';
		const tip = document.createElement('p');
		tip.className = 'tip';

		// What each build shown is, and its version.json once read
		const what = Object.create(null);
		const versions = Object.create(null);
		let described = build;

		// "<text> <date> · <sha>", the sha linked to its commit
		function line(text, commit, repo) {
			const span = document.createElement('span');
			span.append(`${text} ${day(commit.date)}`);
			if (commit.sha) {
				const link = document.createElement('a');
				link.href = `${repo}/commit/${commit.sha}`;
				link.target = '_blank';
				link.rel = 'noopener';
				link.textContent = commit.sha.slice(0, 7);
				span.append(' · ', link);
			}
			return span;
		}

		function describe(folder) {
			described = folder;
			const version = versions[folder];
			const lines = [document.createElement('span')];
			lines[0].textContent = what[folder];
			if (version && version.date) {
				lines.push(line('Updated on', version, REPO));
			}
			if (version && version.base && version.base.date) {
				lines.push(line('Based on upstream of', version.base, UPSTREAM));
			}
			tip.replaceChildren(...lines);
		}

		for (const folder in BUILDS) {
			if (folder === 'native-plugin-manager' && build !== folder && !roAccessKey.stored()) {
				continue;
			}
			const href = `${root}/${folder}/${site}/`;
			const link = document.createElement('a');
			const name = document.createElement('span');
			const date = document.createElement('span');
			link.href = `${href}api.html?app=ONLINE`;
			if (folder === build) {
				link.setAttribute('aria-current', 'page');
			}
			name.textContent = BUILDS[folder][0];
			date.className = 'date';
			link.append(name, date);
			what[folder] = BUILDS[folder][1];
			if (folder === 'cyro' && served) {
				what[folder] = `The version CyRO serves right now, built on ${served}.`;
				date.textContent = served;
			}
			link.addEventListener('pointerenter', () => describe(folder));
			link.addEventListener('focus', () => describe(folder));
			box.append(link);

			fetch(`${href}version.json`, { cache: 'no-store' })
				.then(res => (res.ok ? res.json() : null))
				.then(version => {
					if (!version || !version.date) {
						return;
					}
					versions[folder] = version;
					date.textContent = date.textContent || day(version.date);
					if (described === folder) {
						describe(folder);
					}
				})
				.catch(() => {});
		}

		// The tip stays on the hovered build while the pointer goes to its links
		nav.addEventListener('pointerleave', () => describe(build));
		nav.addEventListener('focusout', e => {
			if (!nav.contains(e.relatedTarget)) {
				describe(build);
			}
		});

		describe(build);
		nav.append(style, box, tip);
		document.body.append(nav);

		function sync() {
			nav.hidden = !LOGIN.some(id => document.getElementById(id));
		}
		sync();
		new MutationObserver(sync).observe(document.body, { childList: true });
	}

	if (document.body) {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init);
	}
})();
