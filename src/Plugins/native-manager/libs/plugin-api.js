/**
 * plugin-api — the native engine-module surface the libs import from.
 *
 * The v3 framework shipped this as a package of lazy transparent Proxies that
 * re-resolved each native module from an ambient global bag on every access.
 * The native host controls boot order and holds the real modules statically,
 * so here the surface is **direct module references** — no proxies, no ambient
 * globals. Every module below is already part of the engine's own import
 * graph, so importing it here adds nothing to the boot.
 *
 * `UIComponent` is GUIComponent (the shadow-DOM base class). `PluginManager`
 * has no native module and stays `undefined` — the no-crash contract: absent
 * capability → `undefined`, never an exception.
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
import Altitude from 'Renderer/Map/Altitude.js';
import Camera from 'Renderer/Camera.js';
import DB from 'DB/DBManager.js';
import Client from 'Core/Client.js';
import MapRenderer from 'Renderer/MapRenderer.js';
import MiniMap from 'UI/Components/MiniMap/MiniMap.js';
import EffectManager from 'Renderer/EffectManager.js';
import WebGL from 'Utils/WebGL.js';
import Texture from 'Utils/Texture.js';
import SkillInfo from 'DB/Skills/SkillInfo.js';
import SkillConst from 'DB/Skills/SkillConst.js';
import SkillEffect from 'DB/Skills/SkillEffect.js';
import SkillAction from 'DB/Skills/SkillAction.js';
import SkillDescription from 'UI/Components/SkillDescription/SkillDescription.js';
import SkillTargetSelection from 'UI/Components/SkillTargetSelection/SkillTargetSelection.js';
import ItemInfo from 'UI/Components/ItemInfo/ItemInfo.js';
import ShortCut from 'UI/Components/ShortCut/ShortCut.js';
import StatusInfo from 'DB/Status/StatusInfo.js';
import StatusIcons from 'UI/Components/StatusIcons/StatusIcons.js';
import EffectTable from 'DB/Effects/EffectTable.js';
import AIDriver from 'Core/AIDriver.js';
import BGM from 'Audio/BGM.js';
import SoundManager from 'Audio/SoundManager.js';
import PathFinding from 'Utils/PathFinding.js';
import Configs from 'Core/Configs.js';

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

// ── The rest of the plugin surface (default export of each module). ──
export { Altitude, Camera, DB, Client, MapRenderer, MiniMap, EffectManager, WebGL, Texture };
export { SkillInfo, SkillConst, SkillEffect, SkillAction, SkillDescription, SkillTargetSelection };
export { ItemInfo, ShortCut, StatusInfo, StatusIcons, EffectTable, AIDriver };
export { BGM, SoundManager, PathFinding, Configs };

// No native module behind this name.
export const PluginManager = undefined;
