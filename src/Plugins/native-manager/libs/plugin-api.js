/**
 * plugin-api — the native engine-module surface the libs import from.
 *
 * The v3 framework shipped this as a package of lazy transparent Proxies that
 * re-resolved each native module from an ambient global bag on every access.
 * The native host controls boot order and holds the real modules statically,
 * so here the surface is **direct module references** — no proxies, no ambient
 * globals.
 *
 * Two groups:
 *   1. **Resolved** — the 6 engine modules (from the ENGINE map) + 5 extra real
 *      modules the libs need (Network, Session, Background, UIManager,
 *      PacketLength). These are the live module objects.
 *   2. **Declared-undefined** — the remaining names from the v3 surface that
 *      aren't wired natively yet. They are exported as `undefined` so a lib
 *      doing `import { StatusInfo } from './plugin-api.js'` links without a
 *      throw (the name exists, its value is `undefined`). The no-crash
 *      contract: absent capability → `undefined`, never an exception.
 *
 * The libs consume this by relative import (`./plugin-api.js`) so the core
 * stays free of ambient-global specifiers.
 */

import { ENGINE } from 'Plugins/native-manager/engine-modules.js';
import Network from 'Network/NetworkManager.js';
import Session from 'Engine/SessionStorage.js';
import Background from 'UI/Background.js';
import UIManager from 'UI/UIManager.js';
import PacketLength from 'Network/PacketLength.js';

// ── Group 1 : the 6 engine modules (re-exported from the session-1 ENGINE map;
// ENGINE.UIComponent is GUIComponent — the shadow-DOM base class). ──
export const PACKET = ENGINE.PACKET;
export const ChatBox = ENGINE.ChatBox;
export const UIComponent = ENGINE.UIComponent;
export const Preferences = ENGINE.Preferences;
export const Commands = ENGINE.Commands;
export const EntityManager = ENGINE.EntityManager;

// ── Group 1 (cont.) : the 5 extra real modules the libs reach for. ──
export { Network, Session, Background, UIManager, PacketLength };

// ── Group 2 : names present in the v3 surface but not wired natively yet.
// Declared `undefined` so every name links; wire them in a later session as
// the plugins that need them appear. ──
export const PluginManager = undefined;
export const Camera = undefined;
export const DB = undefined;
export const SkillInfo = undefined;
export const PathFinding = undefined;
export const Client = undefined;
export const ShortCut = undefined;
export const SkillTargetSelection = undefined;
export const SkillConst = undefined;
export const SkillDescription = undefined;
export const ItemInfo = undefined;
export const AIDriver = undefined;
export const SkillEffect = undefined;
export const SkillAction = undefined;
export const EffectTable = undefined;
export const MapRenderer = undefined;
export const BGM = undefined;
export const SoundManager = undefined;
export const MiniMap = undefined;
export const EffectManager = undefined;
export const WebGL = undefined;
export const Texture = undefined;
export const Configs = undefined;
export const StatusInfo = undefined;
export const StatusIcons = undefined;
