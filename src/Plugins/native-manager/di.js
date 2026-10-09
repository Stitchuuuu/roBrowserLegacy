/**
 * Native Plugin Manager — DI map assembly.
 *
 * `buildDiMap()` returns the object injected as the 2nd `init(pars, diMap)`
 * param. It merges the engine modules (ENGINE) with the native libs. Session 3
 * will pass cross-plugin exports as `pluginExports` and spread them in.
 *
 * Importing this module transitively evaluates the libs — in particular
 * lifecycle's packet-wiring auto-starts (it polls PACKET at module eval), so
 * WIRE_COMPLETE / map phases begin firing as soon as the host boots.
 *
 * No-crash contract: the map is a plain object, so an absent key reads as
 * `undefined`, never a throw.
 */

import { ENGINE } from 'Plugins/native-manager/engine-modules.js';
import LegacyUIComponent from 'Plugins/native-manager/legacy-ui-component.js';
import * as ui from 'Plugins/native-manager/libs/ui.js';
import * as lifecycle from 'Plugins/native-manager/libs/lifecycle.js';
import * as icons from 'Plugins/native-manager/libs/icons.js';
import { on, off, once, emit, EVENTS } from 'Plugins/native-manager/libs/event-bus.js';
import { observePacket, observeSendPacket } from 'Plugins/native-manager/libs/packet-observer.js';
import { observeSocket } from 'Plugins/native-manager/libs/socket-observer.js';
import { devLog } from 'Plugins/native-manager/libs/dev-log.js';
import * as pluginApi from 'Plugins/native-manager/libs/plugin-api.js';
import * as eventBus from 'Plugins/native-manager/libs/event-bus.js';
import * as packetObserver from 'Plugins/native-manager/libs/packet-observer.js';
import * as socketObserver from 'Plugins/native-manager/libs/socket-observer.js';
import * as devLogLib from 'Plugins/native-manager/libs/dev-log.js';
import { fetchIntercept } from 'Plugins/native-manager/libs/fetch-intercept.js';

/**
 * Every lib's whole namespace, keyed by its plain lib name. A plugin built
 * against the lib names (rather than the flattened keys below) reads them here.
 */
const LIBS = Object.freeze({
	'plugin-api': pluginApi,
	'event-bus': eventBus,
	lifecycle,
	ui,
	icons,
	'packet-observer': packetObserver,
	'socket-observer': socketObserver,
	'dev-log': devLogLib,
	'fetch-intercept': fetchIntercept,
});

/**
 * Build the DI map for a plugin's `init(pars, diMap)`.
 *
 * @param {Object<string, *>} [pluginExports] cross-plugin exports (session 3+).
 * @returns {Object<string, *>}
 */
export function buildDiMap(pluginExports) {
	return {
		// Engine modules (session 1)
		...ENGINE,
		// `(name, html, css)` window class for plugins on the old UIComponent
		LegacyUIComponent,
		// Lib namespaces
		ui,
		lifecycle,
		icons,
		// Event bus (flattened primitives)
		on, off, once, emit, EVENTS,
		// Packet / socket observers (flattened)
		observePacket, observeSendPacket, observeSocket,
		// Misc helpers
		devLog,
		icon: icons.icon,
		// Whole lib namespaces by lib name
		libs: LIBS,
		// Cross-plugin exports (session 3+)
		...(pluginExports || {}),
	};
}
