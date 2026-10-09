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
  skips it, and `onLoad` then calls `rebuild()` on each entry. Everything else
  is removed as before. Because one list drives both sides, they cannot drift
  apart.
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
- **Loading screen:** the kept hosts get `visibility: hidden` at black, at
  the cut to the loading image. They get it back at black after the load, and
  also on `MapRenderer.cancelLoad`. A same-map teleport hides nothing.
- **Fades** (`Background`): `transitionDuration` defaults to 255 ms per half.
  `setLoading` fades out and cuts to the image. `remove` cuts to black when a
  background image is up (after a map load) and fades when it is not
  (same-map teleport). It always fades from black.
- **`CZ_NOTIFY_ACTORINIT`** is sent from `onLoad`, at black, on both paths,
  after the kept set has been rebuilt.

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
- **`CZ_NOTIFY_ACTORINIT` after the fade-out on a same-map teleport.** The
  client sends it before. Here the server's answer (the inventory, equipment
  and status re-send) would arrive during the fade, and the rebuild at black
  would then empty the inventory and equipment windows it had just filled.
  Until those `onRemove` clears are reworked, the packet stays after the
  rebuild, and the entities appear during the fade-in.
- **First entry from the character screen:** that background is already up, so
  the loading image replaces it without a fade, as before.

## Where the details come from

ver12: the reset `fcn.0056d410` calls the window purge `fcn.004dd9c0`, and the
factory's case 0 rebuilds the flagged windows. The fade-out is `fcn.00505760`
(a blocking `timeGetTime` loop up to `0xff`), the fade-in `fcn.005056e0`. The
loading screen comes from `OnInit` `fcn.0056c8b0`. 2022 and mars26 have the
same structure.
