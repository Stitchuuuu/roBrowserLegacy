import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	// Mirrors GUIComponent: append() attaches the host and runs onAppend(), remove() detaches it.
	class MockGUIComponent {
		constructor(name) {
			this.name = name;
			this.__loaded = false;
		}

		prepare() {
			this._host = document.createElement('div');
			this._host.innerHTML = this.render();
			this.__loaded = true;
			if (this.init) this.init();
		}

		getRoot() {
			return this._host;
		}

		append() {
			document.body.appendChild(this._host);
			this.onAppend();
		}

		remove() {
			if (this._host.parentNode) {
				this._host.remove();
				this.onRemove();
			}
		}
	}
	MockGUIComponent.MouseMode = { CROSS: 0 };

	return { MockGUIComponent };
});

vi.mock('DB/DBManager.js', () => ({
	default: {
		INTERFACE_PATH: '',
		getMapInfo: () => ({ notifyEnter: true, signName: { mainTitle: 'Hugel', subTitle: 'Village' } })
	}
}));
vi.mock('Core/Client.js', () => ({ default: { loadFile: vi.fn() } }));
vi.mock('Core/Events.js', () => ({
	default: { setTimeout: (cb, delay) => setTimeout(cb, delay), clearTimeout: id => clearTimeout(id) }
}));
vi.mock('UI/GUIComponent.js', () => ({ default: mocks.MockGUIComponent }));
vi.mock('UI/UIManager.js', () => ({ default: { addComponent: c => c } }));

const MapName = (await import('UI/Components/MapName/MapName.js')).default;

function enterMap(mapname) {
	MapName.setMap(mapname);
	MapName.append();
}

describe('MapName banner timing', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.innerHTML = '';
		MapName.resetState();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('is fully opaque from the first frame, with no fade-in', () => {
		enterMap('hugel.gat');

		expect(MapName._host.parentNode).toBe(document.body);
		expect(MapName._host.style.opacity).toBe('1');
		expect(MapName._host.style.transition).toBe('none');
	});

	it('holds until 5000 ms, then starts a short fade-out', () => {
		enterMap('hugel.gat');

		vi.advanceTimersByTime(4999);
		expect(MapName._host.style.opacity).toBe('1');

		vi.advanceTimersByTime(1);
		expect(MapName._host.style.opacity).toBe('0');
		expect(MapName._host.style.transition).toBe('opacity 255ms linear');
	});

	it('is removed once the fade-out ends', () => {
		enterMap('hugel.gat');

		vi.advanceTimersByTime(5254);
		expect(MapName._host.parentNode).toBe(document.body);

		vi.advanceTimersByTime(1);
		expect(MapName._host.parentNode).toBe(null);
	});

	it('shows nothing when the map does not change', () => {
		enterMap('hugel.gat');
		vi.advanceTimersByTime(6000);

		enterMap('hugel.gat');

		expect(MapName._host.parentNode).toBe(null);
	});

	it('comes back at full opacity on the next map after a fade-out', () => {
		enterMap('hugel.gat');
		vi.advanceTimersByTime(6000);

		enterMap('prontera.gat');

		expect(MapName._host.style.opacity).toBe('1');
		expect(MapName._host.style.transition).toBe('none');
	});
});
