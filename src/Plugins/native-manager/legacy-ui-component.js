/**
 * Native Plugin Manager — the `(name, html, css)` window class, for plugins
 * still written against the old UIComponent (`new UIComponent(name, HTML, CSS)`).
 *
 * Transitional: those plugins move to `deps.UIComponent` (GUIComponent) as
 * they migrate to DI, and this file goes away.
 *
 * A fork that still ships `UI/UIComponent.js` gets that class as is. Otherwise
 * it is GUIComponent with the old contract on top :
 *   - `render()` returns the HTML, so it lands in the shadow root ;
 *   - `ui[0]` is that rendered root element, while the `.ui` proxy's
 *     css/show/hide/offset… keep acting on the host ;
 *   - a root positioned against the page (absolute / fixed) hands its position
 *     to the host, which opens it where the old class did and gives dragging
 *     and clamping its real size.
 * The lookup is a glob : a file missing from the fork is an absent key, not a
 * build error.
 */

const BASES = import.meta.glob(['../../UI/UIComponent.js', '../../UI/GUIComponent.js'], {
	eager: true,
	import: 'default'
});

const PLACEMENT = ['top', 'right', 'bottom', 'left'];

/**
 * Move a page-positioned root's position onto the host, measured against the
 * box the old class laid it out in (the page).
 *
 * @param {HTMLElement} host
 * @param {HTMLElement} el - rendered root, inside the host's shadow root
 */
function hostPosition(host, el) {
	document.body.appendChild(host);
	const position = getComputedStyle(el).position;
	if (position !== 'absolute' && position !== 'fixed') {
		return;
	}
	host.style.inset = '0';
	const rect = el.getBoundingClientRect();
	host.style.inset = '';
	host.style.left = rect.left + 'px';
	host.style.top = rect.top + 'px';
	el.style.setProperty('position', 'relative', 'important');
	for (const side of PLACEMENT) {
		el.style.setProperty(side, 'auto', 'important');
	}
}

/**
 * @param {typeof import('UI/GUIComponent.js').default} GUIComponent
 */
function adapt(GUIComponent) {
	return class LegacyUIComponent extends GUIComponent {
		/**
		 * @param {string} name
		 * @param {string} [html]
		 * @param {string} [css]
		 */
		constructor(name, html, css) {
			super(name, css);
			this._html = html || '';
		}

		render() {
			return this._html;
		}

		_createUIProxy() {
			super._createUIProxy();
			const el = this._container.firstElementChild;
			if (!el) {
				return;
			}
			this.ui[0] = el;
			hostPosition(this._host, el);
		}
	};
}

const UIComponent = BASES['../../UI/UIComponent.js'];
const GUIComponent = BASES['../../UI/GUIComponent.js'];

export default UIComponent || (GUIComponent && adapt(GUIComponent));
