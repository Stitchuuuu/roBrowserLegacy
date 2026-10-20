# Map transition: what stays on screen, and the fades

What happens to the windows and the screen when the player is moved: a
teleport on the same map, or a change of map with a loading screen.

## The native client

The three builds agree on all of this.

1. **Windows persist.** Every move ends in the same "enter world" reset. It
   destroys the windows and, before the next frame, rebuilds the ones the
   player had open (basic info, inventory, equipment, status, skill list,
   minimap, shortcut bar) at their positions. The chat window is never
   destroyed. Windows without an open flag (NPC dialogs, shops, storage,
   trade, …) are closed. **No frame ever shows a kept window missing.**
2. **Same map:** the reset runs first and sends `CZ_NOTIFY_ACTORINIT`. Then
   comes a 255 ms fade to black over a frozen copy of the last frame, then a
   255 ms fade from black. No loading screen.
3. **Map change:** 255 ms fade to black, then a cut to the loading image. The
   chat is hidden and no other window is shown. After the load, a cut to
   black, the reset (with `CZ_NOTIFY_ACTORINIT`), and a 255 ms fade from black.
4. Both fades last 255 ms of wall clock. The overlay's alpha byte is the
   elapsed time in milliseconds.

## This port

- **The kept set is the map UI list**, `getMapUI()` in `MapEngine`. The same
  array is passed to `MapRenderer.setMap`, where `UIManager.removeComponents`
  skips it, and `onLoad` then calls `rebuild()` on each entry. Because one list
  drives both sides, they cannot drift apart.
- **Everything else goes at black**, not when the move starts. The fade to
  black runs over a frozen canvas with the windows as they were, as the
  client fades a frozen copy of its last frame: no DOM change happens during
  the fade. The removal runs first thing at black, before the loading screen
  hides the windows or `onLoad` restarts them, and not at all when the load
  was cancelled in the meantime: the engine that cancelled it clears the
  windows itself. The overlay covers every window during the fade, so a click
  there does nothing.
- **Kept components restart in place.** `rebuild()` runs the `remove()`
  lifecycle (`onRemove`, key and mouse cleanup) and then `append()`, but it
  never takes the host out of the DOM. `append()` does not move a host that is
  already under the requested parent. Detaching and re-attaching would cost a
  style and layout pass per window, and that was the whole stall. The hooks
  have to run: `Renderer.stop()` drops every render callback at the start of a
  transition, and components such as the minimap, the status icons, the FPS
  counter and navigation register theirs again in `onAppend`. Child windows
  (the quest window, the switch-equip panel) are appended from there too. Both
  hooks run back to back at black, so no frame shows a window that has been
  emptied, which is the client's destroy-and-rebuild between two frames.
- **A restart keeps what the transition does not change.** `rebuild()` passes
  `true` to `onRemove` and `onAppend` when it restarts a window in place (a
  first append, or a plain `remove()` / `append()`, passes nothing):
  - the inventory, the cart and the equipment keep their items, which the
    server sends again after the load and which replace them by index;
  - the chat keeps its active tab, the shortcut bar its running cooldowns,
    the minimap its party, guild and NPC marks until the map changes;
  - the attendance window prints its "no event" notice once, not on every
    teleport.

  The base class itself skips what only a detach needs: no `x_remove` sent
  to every node, and the scrollbar observer stays. The world map builds its
  view when it is opened, not on every append while hidden.
- **Loading screen:** every window on screen gets `visibility: hidden` at
  black, at the cut to the loading image, right after the removal. They get it
  back at black after the load, and also on
  `MapRenderer.cancelLoad` and a failed load. A same-map teleport hides
  nothing.
- **Fades** (`Background`): `transitionDuration` defaults to 255 ms per half.
  A fade to black shows its black frame before the work done at black runs.
  `setLoading` fades out and cuts to the image. `remove` cuts to black when a
  background image is up (after a map load) and fades when it is not
  (same-map teleport). It always fades from black, once the display frames
  stay on time: 150 ms of frames under 25 ms each, waiting at most a second.
  The work done at black (the windows restarting, the first frames of a new
  map) then lands before the fade, not in it.
- **Smooth, an option** (`mapTransition: 'smooth'`; the default `'client'` is
  everything above). A map change fades where the client cuts: the map fades
  to black, the loading image comes out of black, and after the load the image
  fades to black before the new map comes out of black. The work done at black
  is the same, at the same moments. Each of the four fades lasts 125 ms
  (`SMOOTH_DURATION` in `Background`), about the client's two of 255 ms. The image comes out of black once three frames in a row
  are on time, and the load starts only once it is shown: a load running under
  the fade made it stutter. After the load, the image stays still until three
  frames in a row are on time again: the renderer set up at the end of a load
  holds the frames for about 100 ms with no page script running, and a fade
  started there stuttered. A same-map teleport keeps the client's two fades. The
  server sets the default in `ROConfig.mapTransition`, the player's choice in
  the graphics options (`GraphicsSettings.mapTransition`) overrides it.
  `Background` reads the mode itself, because the plugin libs wrap
  `Background.remove(callback)` and forward the callback only.
- **`CZ_NOTIFY_ACTORINIT`**: a same-map teleport sends it before the fade, as
  the client does; the inventory and equipment the server sends back in the
  meantime survive the restart at black. A map change sends it from `onLoad`,
  at black, after the kept set has restarted.

## Deviations

- **More windows are kept than the client keeps.** Everything on the map UI
  list stays attached, including windows the client has no open flag for
  (Escape, cart, vending, world map, …). They were re-appended on every
  transition before, so nothing that used to be shown after a transition is
  lost.
- **The whole kept set is hidden during the load, not just the chat.** It
  looks the same: the client's other windows do not exist at that point.
- **Rebuilt in place, not reconstructed.** The client builds new window
  objects. Here the same component runs its `onRemove` / `onAppend` pair.
  Anything a component keeps outside those hooks survives the transition.
- **Black lasts longer when the page is busy.** The client starts its fade
  from black right after the reset. Here it waits for the display frames to
  come back on time, up to a second, so the fade itself never stutters.
- **Smooth is not the client's.** The client cuts to and from the loading
  image. Smooth is there for players who find the cuts harsh. Its four fades
  take about the client's two (4 × 125 against 2 × 255 ms); the waits for
  frames on time cover work that holds the frames in the client mode too.
- **The keyboard stays live during the fade to black.** A window still on
  screen can take a key: Enter on an NPC dialog sends its next step to an NPC
  whose script already ended with the warp, which the server ignores.
- **The mobile auto-targeting switches off on every transition**, as before
  this port. It is not a client feature, so there is nothing to match.
- **First entry from the character screen:** that background is already up, so
  the loading image replaces it without a fade, as before.

## Map name banner

The banner with the map's name ("Hugel", "Prontera") shown on entering a map
listed in `System/mapInfo.lub` with `notifyEnter`.

### Rules

- **No fade-in.** The banner is at full opacity from the moment it is
  appended. It is appended at black, under the screen overlay, so it comes out
  of the black together with the map: when the screen clears, it is already
  all there.
- **Hold 5 s, then a 255 ms linear fade-out**, then it is removed. Not a 1 s
  fade on either side.
- **Same map, no banner.** A teleport within the map does not show it again.
- **Layout is unchanged** (500x190 at `top: 90px`). The client sizes it from
  the screen instead; that is a separate question.

### Why

The client starts the banner's clock when it is created and draws it every
frame with an alpha read off that clock:

| elapsed | alpha |
|---|---|
| below 5001 ms (`0x1389`) | 255, fully opaque from the first frame |
| from 5001 ms | `5255 - elapsed` (`0x1487`), a linear fade of about 254 ms |

There is no ramp up. The banner is created right after the "enter world"
reset that arms the fade from black, and in the per-frame draw it is painted
after the windows and **before** the black overlay. So during the fade the
black covers it, and it is revealed with the rest of the scene.

- 2022: entry `fcn.007761a0` calls the banner `fcn.009270f0` at `0x007769c5`,
  after the reset `fcn.0076f990` at `0x007768ca`. `fcn.009270f0` checks
  `notifyEnter` and builds it in `fcn.009262f0`, which stores the start time.
  The draw `fcn.009277c0` holds the constants above. In the frame
  `fcn.00777850`, windows `fcn.006401d0`, then banner `fcn.009277c0`, then the
  black fade `fcn.00660290`.
- mars26: same structure. Entry `fcn.00b419a0`, reset `fcn.00b39880` at
  `0x00b421cc`, then `fcn.00b51ce0` -> `fcn.005f7510` -> builder
  `fcn.005f6790`. Draw `fcn.005f7bf0`, same `0x1389` / `0x1487`. In the frame
  `fcn.00b42d70` the banner is drawn before the black fade `fcn.0091ad60`.
- ver12 has no banner at all: no `display_mapname`, `mapInfo.lub` or
  `AddMapDisplayName` in it. It is a post-Renewal feature.

### Deviations

- **The clock starts at `append()`**, in `MapRenderer.onLoad`, which runs at
  black just before the screen starts to clear: the same point as the client.
  The banner sits under the `Background` overlay (z-index 1000), so it is
  revealed by that fade, which lasts `transitionDuration` (500 ms by default)
  rather than the client's 255 ms. That length belongs to the screen fade, not
  to the banner.
- The removal is timed on the game loop, the fade on a CSS transition. The
  last frame of the fade may be cut, which is not visible.

## Where the details come from

ver12: the reset `fcn.0056d410` calls the window purge `fcn.004dd9c0`, and the
factory's case 0 rebuilds the flagged windows. The fade-out is `fcn.00505760`
(a blocking `timeGetTime` loop up to `0xff`), the fade-in `fcn.005056e0`. The
loading screen comes from `OnInit` `fcn.0056c8b0`. 2022 and mars26 have the
same structure.
