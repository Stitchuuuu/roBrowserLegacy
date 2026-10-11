# The cart window

Background for `src/UI/Components/CartItems/`: when the window's position and
size are saved, how they are stored, and where its size limits differ from the
client's.

## Rules

- **Save whenever the window goes away, the close button included.** The
  client does, so rows added by a resize survive both a reopen and a relog.
  Here that is the close button, the end of a resize, and `onRemove` (map
  change, logout). A browser tab closed mid-session never reaches `onRemove`,
  so without the first two a resize was lost.
- **Read the size from the inline style that `resize()` sets, never from the
  window's rect.** A closed window is `display: none` and has a 0x0 rect, so a
  save on map change after a close used to store -1 columns and -1 rows,
  clamped back to the minimum on the next login.
- **A reduced window saves its full height.** While reduced the host is 17px
  tall. The height to restore is the one kept in `_realSize`.
- **Restore `reduce` by calling `onToggleReduction()`, and take the full height
  from the inline style.** `onAppend` used to fire a `mousedown` on a button
  that listens to `click`, so a reduced cart always reopened full size, and a
  full-size one was left in a state where the first click did nothing.

## What the client does

| | client | here |
|---|---|---|
| keys | `MERCHANTITEMWNDINFO.X / .Y / .W / .H / .SHOW` | `CartItems` preference: `x, y, width, height, show, reduce` |
| W / H | pixels | columns / rows |
| saved | when the window is destroyed: close button, map load, exit | close button, end of resize, `onRemove` |
| width | 232-320px, 6-8 columns | 6-9 columns |
| height | 120-240px on a 32px grid from 120, 2-5 rows (120, 152, 184, 216) | 2-6 rows, `31 + 19 + 32 * rows` (114px at 2 rows) |
| reduce button | none, close only | present |

The three builds agree on all of this. The window is built at 280x120, then
resized to the saved W/H and moved to the saved X/Y. The save copies the live
rect into the stored info when the window is destroyed (ver12 `fcn.004c3100`,
2022 `fcn.0061f830`, mars26 `fcn.0087b900`). On ver12 the close path is traced
end to end: the close button queues the window for destruction, and the
per-frame cleanup runs the save before freeing it. On 2022 and mars26 the
pieces are found but the close-to-save path was not walked.

ver12 writes SHOW on close, but no reader of it was found: the cart does not
reopen by itself on map change there.

## Deviations

- **Bounds stay 6-9 x 2-6.** The client stops at 8 columns and 5 rows. A player
  used to a 9x6 cart would lose a row and a column, so the wider range is kept
  on purpose.
- **The reduce button stays.** The client has none.
- **`show` is restored.** A cart left open reopens open after a map change or a
  relog.

## See also

- `InventoryCommon.js` and `StorageCommon.js` save the same way, in `onRemove`
  only, and read the size from the rect, so they share the hidden-window loss.
