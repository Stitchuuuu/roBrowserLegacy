/**
 * tests/network/CameraTile.test.js
 *
 * A camera tile (api.html#camera in a frame of the camera page): lighter settings kept in memory, no way to
 * change bot from inside, and the « Scene only » rule.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	joinRoom: vi.fn(() => ({ on: () => {}, leave: () => {} }))
}));

vi.mock('UI/UIManager.js', () => ({ default: { showErrorBox: vi.fn() } }));
vi.mock('Vendors/signal/index.js', async importOriginal => ({
	...(await importOriginal()),
	joinRoom: mocks.joinRoom
}));

const { newSecret } = await vi.importActual('Vendors/signal/index.js');
const ROOM = { relay: 'wss://relay.example/', relayKey: '', room: 'b', secret: newSecret(), character: 'B' };

/** Load the tile's modules on a page opened with this hash, in a frame of the given parent, over these stored prefs */
async function load(hash, parent, stored = {}) {
	history.replaceState(null, '', '/api.html' + hash);
	vi.unstubAllGlobals();
	if (parent) {
		vi.stubGlobal('parent', parent);
	}
	localStorage.clear();
	for (const key in stored) {
		localStorage.setItem(key, stored[key]);
	}
	vi.resetModules();
	return {
		CameraTile: (await import('Network/CameraTile.js')).default,
		Scene: await import('Network/CameraTile.js'),
		RemoteBot: (await import('Network/RemoteBot.js')).default,
		AudioPrefs: (await import('Preferences/Audio.js')).default,
		GraphicsSettings: (await import('Preferences/Graphics.js')).default,
		Configs: (await import('Core/Configs.js')).default
	};
}

const sameOrigin = () => ({ location: { origin: window.location.origin } });

describe('camera tile', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		document.head.querySelectorAll('style').forEach(node => node.remove());
	});

	it('is a tile only with #camera in a frame of a page of this origin', async () => {
		expect((await load('#camera', sameOrigin())).CameraTile.active).toBe(true);
		expect((await load('', sameOrigin())).CameraTile.active).toBe(false);
		expect((await load('#camera')).CameraTile.active).toBe(false); // the top page
		expect((await load('#camera', { location: { origin: 'https://other.example' } })).CameraTile.active).toBe(false);
		const crossOrigin = {
			get location() {
				throw new DOMException('cross-origin', 'SecurityError');
			}
		};
		expect((await load('#camera', crossOrigin)).CameraTile.active).toBe(false);
	});

	it('mutes the sound, caps the frames and lowers the quality in memory, never in the shared localStorage', async () => {
		const stored = {
			Audio: JSON.stringify({ BGM: { play: true, volume: 0.5 }, Sound: { play: true, volume: 0.5 }, _version: 1.0 }),
			Graphics: JSON.stringify({ quality: 100, fpslimit: -1, _version: 1.1 })
		};
		const { AudioPrefs, GraphicsSettings, Configs } = await load('#camera', sameOrigin(), stored);

		expect(AudioPrefs.BGM.play).toBe(false);
		expect(AudioPrefs.Sound.play).toBe(false);
		expect(GraphicsSettings.fpslimit).toBe(15);
		expect(Configs.get('quality', 100)).toBe(50);
		// The other tiles and the normal tab read the same storage: nothing written
		expect(localStorage.getItem('Audio')).toBe(stored.Audio);
		expect(localStorage.getItem('Graphics')).toBe(stored.Graphics);
	});

	it('changes nothing in a normal window', async () => {
		const { AudioPrefs, GraphicsSettings, Configs } = await load('', sameOrigin());

		expect(AudioPrefs.BGM.play).toBe(true);
		expect(GraphicsSettings.fpslimit).toBe(-1);
		expect(Configs.get('quality', 100)).toBe(100);
		expect(document.head.querySelector('style')).toBe(null);
	});

	it('tells the camera page it is ready, then attaches once to the room it posts', async () => {
		const parent = { ...sameOrigin(), postMessage: vi.fn() };
		const { CameraTile } = await load('#camera', parent);
		const attach = vi.fn();
		const post = (data, source = parent, origin = window.location.origin) =>
			window.dispatchEvent(new MessageEvent('message', { data, source, origin }));

		post({ t: 'camera-room', room: ROOM }); // before it asked: no use
		CameraTile.wait(attach);
		expect(parent.postMessage).toHaveBeenCalledWith({ t: 'camera-ready' }, window.location.origin);

		post({ t: 'camera-room', room: ROOM }, parent, 'https://other.example');
		post({ t: 'camera-room', room: ROOM }, window);
		expect(attach).not.toHaveBeenCalled();

		post({ t: 'camera-room', room: ROOM });
		post({ t: 'camera-room', room: ROOM });
		expect(attach).toHaveBeenCalledTimes(1);
		expect(attach).toHaveBeenCalledWith(ROOM);
	});

	it('changes no bot from inside: no switch, no control taken on entry, no paste box', async () => {
		const { RemoteBot } = await load('#camera', sameOrigin());
		const ask = vi.fn();

		RemoteBot.setLoginScreen(ask);
		window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', altKey: true, shiftKey: true }));
		expect(ask).not.toHaveBeenCalled();

		RemoteBot.useRoom({ ...ROOM, control: true });
		expect(RemoteBot.takeWantControl()).toBe(false);
		RemoteBot.setLoginScreen(null);
		expect(RemoteBot.switchTo(ROOM)).toBe(false);
		expect(RemoteBot.switching()).toBe(false);
	});

	it('scene only hides every host of body but the scene, the cursor and the life bars over it', async () => {
		const { Scene } = await load('#camera', sameOrigin());
		const rule = document.head.querySelector('style').textContent;

		expect(rule).toBe(Scene.sceneRule());
		document.body.innerHTML =
			'<canvas class="ro-scene"></canvas><div class="cursor"></div><div id="ChatBox"></div><div id="BasicInfo"></div>' +
			'<div class="entity-overlay"><canvas class="entity-life"></canvas><canvas class="entity-display"></canvas>' +
			'<canvas class="entity-dialog"></canvas></div>';
		document.body.classList.add('scene-only');
		const selectors = rule.split('\n').map(line => line.slice(0, line.indexOf('{')).trim());
		const hidden = [...document.body.querySelectorAll('*')].filter(node => selectors.some(s => node.matches(s)));

		// The windows, the names and the chat bubbles go; the scene, the cursor and the life bars stay
		expect(hidden.map(node => node.id || node.className)).toEqual(['ChatBox', 'BasicInfo', 'entity-display', 'entity-dialog']);
		document.body.className = '';
		document.body.innerHTML = '';
	});

	it('scene only keeps one more host once it is listed', async () => {
		const { Scene } = await load('#camera', sameOrigin());

		Scene.SCENE_KEEP.push('#RemoteAlerts');
		expect(Scene.sceneRule()).toContain(':not(#RemoteAlerts)');
		Scene.SCENE_KEEP.pop();
	});
});
