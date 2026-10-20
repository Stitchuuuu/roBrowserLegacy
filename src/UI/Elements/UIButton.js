/**
 * UI/Elements/UIButton.js
 *
 * <ui-button bg="btn_ok.bmp" hover="btn_ok_a.bmp" down="btn_ok_b.bmp">OK</ui-button>
 *
 * Replaces: <button data-background="btn_ok.bmp" data-hover="btn_ok_a.bmp" data-down="btn_ok_b.bmp">
 *
 * <ui-button skin="basic_interface/btn">Text</ui-button>
 *
 * 3-slice text button: {skin}_{out,over,press,disable}_{left,mid,right}.bmp
 *
 * @author AoShinHo
 */

import DB from 'DB/DBManager.js';
import Client from 'Core/Client.js';
import Targa from 'Loaders/Targa.js';

// Background layer order, matched by ui-button[skin] in Common.css
const SKIN_PARTS = ['left', 'right', 'mid'];

class UIButton extends HTMLElement {
	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;
		const bg = this.getAttribute('bg');
		const hover = this.getAttribute('hover');
		const down = this.getAttribute('down');
		const skin = this.getAttribute('skin');

		let bgImage = null,
			hoverImage = null,
			downImage = null,
			disableImage = null;
		const state = { hover: false, down: false };

		const update = () => {
			if (this.disabled) {
				if (disableImage || bgImage) {
					this.style.backgroundImage = disableImage || bgImage;
				}
				this.style.opacity = disableImage ? '' : '0.5';
				this.style.cursor = 'default';
				return;
			}
			this.style.opacity = '';
			this.style.cursor = '';
			if (state.down && downImage) {
				this.style.backgroundImage = downImage;
			} else if (state.hover && hoverImage) {
				this.style.backgroundImage = hoverImage;
			} else if (bgImage) {
				this.style.backgroundImage = bgImage;
			} else {
				this.style.backgroundImage = '';
			}
		};
		this._update = update;
		const loadBmp = (path, cb) => {
			if (!path) return;
			Client.loadFile(DB.INTERFACE_PATH + path, dataURI => {
				if (dataURI instanceof ArrayBuffer) {
					try {
						const tga = new Targa();
						tga.load(new Uint8Array(dataURI));
						cb(tga.getDataURL());
					} catch (e) {
						console.error(e.message);
					}
				} else {
					cb(dataURI);
				}
			});
		};

		const loadSkin = (skinState, cb) => {
			const images = [];
			let pending = SKIN_PARTS.length;
			SKIN_PARTS.forEach((part, i) => {
				loadBmp(`${skin}_${skinState}_${part}.bmp`, uri => {
					images[i] = `url(${uri})`;
					if (--pending === 0) {
						cb(images.join(', '));
					}
				});
			});
		};
		const loadImage = (path, skinState, cb) => {
			if (skin) {
				loadSkin(skinState, cb);
			} else {
				loadBmp(path, uri => cb(`url(${uri})`));
			}
		};

		loadImage(bg, 'out', image => {
			bgImage = image;
			update();
		});
		loadImage(hover, 'over', image => {
			hoverImage = image;
		});
		loadImage(down, 'press', image => {
			downImage = image;
		});
		if (skin) {
			loadSkin('disable', image => {
				disableImage = image;
				update();
			});
		}

		this.addEventListener('mouseover', () => {
			if (this.disabled) return;
			state.hover = true;
			update();
		});
		this.addEventListener('mouseout', () => {
			state.hover = false;
			state.down = false;
			update();
		});
		this.addEventListener('mousedown', () => {
			if (this.disabled) return;
			state.down = true;
			update();
		});
		this.addEventListener('mouseup', () => {
			state.down = false;
			update();
		});
		this.addEventListener(
			'click',
			e => {
				if (this.disabled) {
					e.stopImmediatePropagation();
					e.preventDefault();
				}
			},
			true
		);
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}

	set disabled(val) {
		if (val) {
			this.setAttribute('disabled', '');
		} else {
			this.removeAttribute('disabled');
		}
	}
	static get observedAttributes() {
		return ['disabled'];
	}

	attributeChangedCallback(name) {
		if (name === 'disabled' && this._initialized) {
			// Reset hover/down state when becoming disabled
			// The update() closure is inside connectedCallback, so we need a reference
			if (this._update) this._update();
		}
	}
}

customElements.define('ui-button', UIButton);
export default UIButton;
