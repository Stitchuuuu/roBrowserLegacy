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
  black, at the cut to the loading image: the kept set and the plugin windows
  appended since. They get it back at black after the load, and also on
  `MapRenderer.cancelLoad` and a failed load. A same-map teleport hides
  nothing.
- **Fades** (`Background`): `transitionDuration` defaults to 255 ms per half.
  `setLoading` fades out and cuts to the image. `remove` cuts to black when a
  background image is up (after a map load) and fades when it is not
  (same-map teleport). It always fades from black.
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
- **The mobile auto-targeting switches off on every transition**, as before
  this port. It is not a client feature, so there is nothing to match.
- **First entry from the character screen:** that background is already up, so
  the loading image replaces it without a fade, as before.

## Where the details come from

ver12: the reset `fcn.0056d410` calls the window purge `fcn.004dd9c0`, and the
factory's case 0 rebuilds the flagged windows. The fade-out is `fcn.00505760`
(a blocking `timeGetTime` loop up to `0xff`), the fade-in `fcn.005056e0`. The
loading screen comes from `OnInit` `fcn.0056c8b0`. 2022 and mars26 have the
same structure.
