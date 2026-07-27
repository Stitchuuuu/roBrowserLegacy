/**
 * Native Plugin Manager — engine modules (session 1: spike-core).
 *
 * Static imports of the real engine modules, assembled into an internal
 * ENGINE map that the registry injects into each plugin via init(pars, diMap).
 * This is a plain module-scoped object, NOT an ambient global — access is
 * only ever through the DI map.
 *
 * NEVER imports the Tampermonkey framework proxy package (would break the
 * Rollup monolith build and the src/ coexistence grep gate).
 *
 * Injection key → module. `UIComponent` maps to `GUIComponent` (the Shadow-DOM
 * base class; no `UIComponent.js` exists). `Commands` maps to ProcessCommand.
 */

import PACKET from 'Network/PacketStructure.js';
import ChatBox from 'UI/Components/ChatBox/ChatBox.js';
import GUIComponent from 'UI/GUIComponent.js';
import Preferences from 'Core/Preferences.js';
import Commands from 'Controls/ProcessCommand.js';
import EntityManager from 'Renderer/EntityManager.js';

export const ENGINE = {
	PACKET: PACKET,
	ChatBox: ChatBox,
	UIComponent: GUIComponent,
	Preferences: Preferences,
	Commands: Commands,
	EntityManager: EntityManager
};
