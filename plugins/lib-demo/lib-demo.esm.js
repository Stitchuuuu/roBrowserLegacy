/**
 * lib-demo — native plugin manager, session-2 demo.
 *
 * Hand-authored ESM (zero imports, pure DI). Exercises the native libs through
 * the DI map to prove the session-2 wiring end-to-end:
 *   - `lifecycle`      — WIRE_COMPLETE guard + registerCleanup teardown proof.
 *   - `packet-observer`— observePacket increments a live counter on real
 *                        incoming packets.
 *   - `ui`             — registerPlayerWindow + a GUIComponent (shadow-DOM) UI,
 *                        find() (shadow-routed query), makeDraggable.
 *   - `icons`          — injectIconCss into the component's shadow root.
 *   - no-crash         — an un-injected DI key reads `undefined`, no throw.
 *
 * Wire it via ROConfig.plugins as `/plugins/lib-demo/lib-demo.esm.js`.
 */

const COMPONENT_CSS = `
	/* No position here: GUIComponent's host (light-DOM) is position:absolute and
	   drag moves the HOST's left/top — the content must flow INSIDE the host so
	   it moves with it. A position:fixed/absolute here would pin the box to the
	   viewport, decoupled from the host (drag applies opacity but can't move it).
	   The host's initial left/top is set in onMount. */
	.lib-demo {
		width: 190px;
		background: #2b2b3a; color: #e6e6f0;
		border: 1px solid #4a4a6a; border-radius: 6px;
		font: 12px/1.5 system-ui, sans-serif;
		box-shadow: 0 2px 10px rgba(0,0,0,.45); user-select: none;
	}
	.lib-demo-bar {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 9px; background: #3a3a54; cursor: move;
		border-radius: 6px 6px 0 0;
	}
	.lib-demo-bar .ro-icon { font-size: 14px; color: #ffd479; }
	.lib-demo-body { padding: 8px 9px; }
	.lib-demo-count { font-weight: bold; color: #8fe6c0; }
	.lib-demo-nocrash { color: #9aa; }
`;

export default {
	name: 'LibDemo',

	init(pars, deps) {
		const { ui, lifecycle, icons, observePacket, PACKET, EVENTS, once } = deps;

		// ── no-crash contract : an un-injected DI key is `undefined`, no throw ──
		const noCrash = typeof deps.NotAThing; // 'undefined'

		let panel = null;
		let packetCount = 0;

		function refreshCount() {
			if (!panel) { return; }
			const el = ui.find(panel, '.lib-demo-count'); // shadow-routed query
			if (el) { el.textContent = String(packetCount); }
		}

		// ── packet-observer : bind on every reliable in-map ZC packet that the
		// client defines, guarded on WIRE_COMPLETE so PACKET.ZC is populated ──
		function hookPackets() {
			const ZC = PACKET && PACKET.ZC;
			if (!ZC) { return; }
			const candidates = [
				'NOTIFY_PLAYERMOVE', 'NOTIFY_STANDENTRY', 'NOTIFY_MOVEENTRY',
				'NOTIFY_ACT', 'PAR_CHANGE', 'NOTIFY_TIME',
			];
			for (const name of candidates) {
				if (ZC[name]) {
					observePacket(ZC[name], () => { packetCount++; refreshCount(); });
				}
			}
		}
		if (lifecycle.isWired()) { hookPackets(); }
		else { once(EVENTS.WIRE_COMPLETE, hookPackets); }

		// ── ui : a GUIComponent window mounted on map-ready, re-appended across
		// warps by registerPlayerWindow ──
		ui.registerPlayerWindow(
			function panelFactory() {
				const GUIComponent = deps.UIComponent; // ENGINE.UIComponent === GUIComponent
				const c = new GUIComponent('LibDemo', COMPONENT_CSS);
				c.render = function () {
					return '<div class="lib-demo">'
						+ '<div class="lib-demo-bar">'
						+ '<span class="ro-icon ro-icon-bell"></span><span>Lib Demo</span>'
						+ '</div>'
						+ '<div class="lib-demo-body">'
						+ 'packets: <span class="lib-demo-count">0</span><br>'
						+ 'no-crash: <span class="lib-demo-nocrash">' + noCrash + '</span>'
						+ '</div>'
						+ '</div>';
				};
				c.init = function () {
					// `.ro-icon` CSS must land INSIDE this component's shadow root —
					// a global rule in document.head does not pierce the shadow.
					icons.injectIconCss(this.getRoot());
				};
				return c;
			},
			{
				defaultVisible: true,
				onMount(p) {
					panel = p;
					// Position the light-DOM host (can't be styled from inside the
					// shadow CSS). Drag moves these same host left/top afterwards.
					const host = ui.root(p);
					if (host) { host.style.left = '24px'; host.style.top = '90px'; }
					ui.makeDraggable(p, '.lib-demo-bar');
					refreshCount();
				},
			},
		);

		// ── lifecycle : cleanup teardown proof (fires on page unload / reinit) ──
		lifecycle.registerCleanup(function (ev) {
			const reason = ev && ev.reason ? ev.reason : 'unknown';
			console.log('[LibDemo] cleanup: ' + reason);
		});

		return true;
	},
};
