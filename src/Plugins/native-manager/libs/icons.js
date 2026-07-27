/**
 * icons — zero-dependency icon library.
 *
 * Vendored Lucide SVGs (https://lucide.dev, ISC license). The v3 lib pulled
 * these from the `lucide-static` build dependency and normalized them at
 * runtime; here the 11 icons are inlined pre-normalized as compact strings so
 * the native build needs no extra dependency.
 *
 * Two consumption styles, both fed from the same `ICONS` map:
 *   1. CSS classes (no import needed by plugins):
 *        <span class="ro-icon ro-icon-trash-2"></span>
 *      Sized via `font-size` (icon = 1em), tinted via `color` (currentColor).
 *      Injected by injectIconCss(target) — pass a component's shadow root so
 *      the class reaches inside the shadow DOM.
 *   2. Inline <svg> string (for HTML-string builders):
 *        el.innerHTML = icon('trash-2', { size: 14 })
 */

/** name → compact Lucide SVG markup (with `stroke="currentColor"`). */
export const ICONS = {
	'download':   '<svg class="lucide lucide-download" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>',
	'refresh-cw': '<svg class="lucide lucide-refresh-cw" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
	'rotate-cw':  '<svg class="lucide lucide-rotate-cw" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
	'trash-2':    '<svg class="lucide lucide-trash-2" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
	'x':          '<svg class="lucide lucide-x" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
	'search':     '<svg class="lucide lucide-search" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
	'crosshair':  '<svg class="lucide lucide-crosshair" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
	'bell-off':   '<svg class="lucide lucide-bell-off" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/></svg>',
	'rotate-ccw': '<svg class="lucide lucide-rotate-ccw" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
	'bell':       '<svg class="lucide lucide-bell" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>',
	'volume-2':   '<svg class="lucide lucide-volume-2" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>',
}

/**
 * Return an inline `<svg>` string for `name`, tagged with `.ro-icon` (+ optional
 * extra class) and sized to `size` px. Empty string for an unknown name.
 * `stroke="currentColor"` (from Lucide) → the glyph inherits the CSS `color`.
 */
export function icon(name, { size = 16, cls = '' } = {}) {
	const svg = ICONS[name]
	if (!svg) {return ''}
	const klass = cls ? `ro-icon ${cls}` : 'ro-icon'
	return svg
		.replace(/\sclass="[^"]*"/, '')
		.replace(/width="\d+"/, `width="${size}"`)
		.replace(/height="\d+"/, `height="${size}"`)
		.replace(/^<svg /, `<svg class="${klass}" aria-hidden="true" `)
}

/**
 * Inject the icon stylesheet ONCE into `target` (idempotent, keyed on
 * `#ro-icon-css`). Exposes `.ro-icon` (base) + one `.ro-icon-<name>` per icon.
 * Uses CSS `mask` + `background-color: currentColor` so the glyph takes the
 * current text color; sized via `font-size` (1em). The SVG is embedded as a
 * data-URI (zero network, CSP-safe).
 *
 * **Native improvement.** `target` may be a `Document` OR a `ShadowRoot`. A
 * global `.ro-icon` rule in `document.head` does NOT pierce a component's
 * shadow root, so pass `component.getRoot()` / `component._shadow` to make the
 * icon classes work inside a GUIComponent's shadow DOM.
 *
 * @param {Document | ShadowRoot} [target]
 */
export function injectIconCss(target = (typeof document !== 'undefined' ? document : null)) {
	if (!target || target.getElementById('ro-icon-css')) {return}
	const base = '.ro-icon{display:inline-block;width:1em;height:1em;vertical-align:-0.125em;background-color:currentColor;-webkit-mask:var(--ro-i) no-repeat center/contain;mask:var(--ro-i) no-repeat center/contain}'
	const rules = [base]
	for (const [name, svg] of Object.entries(ICONS)) {
		rules.push(`.ro-icon-${name}{--ro-i:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`)
	}
	const doc = target.ownerDocument || (target.createElement ? target : document)
	const style = doc.createElement('style')
	style.id = 'ro-icon-css'
	style.textContent = rules.join('')
	// Document → append to <head> ; ShadowRoot → append to the root itself.
	;(target.head || target.documentElement || target).appendChild(style)
}
