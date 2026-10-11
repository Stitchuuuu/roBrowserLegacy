# Map transition: what stays on screen, and the fades

What happens on screen when the player is moved: a teleport on the same map,
or a change of map with a loading screen.

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
