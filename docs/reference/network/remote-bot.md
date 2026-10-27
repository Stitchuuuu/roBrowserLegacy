# Remote bot: the game window on a running bot's session

The remote mode attaches the game window to a headless client (a
roBrowserLegacy-Node bot started with `--spectate-rtc`) instead of a game
server. The bot stays logged in; it answers the window's login, char and zone
handshakes from its own session, replays a snapshot of the map, then forwards
the live packets both ways. Nothing here is from the original client: it is a
feature of this port.

## Opening it

| page / key | what happens |
|---|---|
| `api.html?app=ONLINE#remote&r=<room>&s=<secret>&relay=<wss url>[&key=<relay key>]` | joins the bot's room at once |
| `api.html?app=ONLINE#remote` | reuses the link kept for this tab, or opens the paste box on the login screen |
| `Alt+Shift+R` on the login screen, or while the page loads | opens the paste box (on the login screen) |

The parameters are the `@meitogi/signal` link format (`parseLink`): `r` the
room, `s` the room secret (43 base64url characters), `relay` the signaling
relay, `key` the relay's application key. The paste box takes the whole link.
A page link that is no bot link is said so on the login screen, then the paste
box opens.

Whatever the page link holds, the address bar is reduced to `#remote`, and a
valid link is kept in `sessionStorage` (`remoteBot`): a reload in the same tab
attaches again, closing the tab forgets the link, and a bookmark of the page
carries no secret.

What the link gives away: whoever has the **secret** can attach to the bot,
and play its character once the bot hands over control. The **relay key**
only spends the relay's bandwidth. The part after `#` never reaches a web
server, but it stays in the browser history and in anything the link is
pasted into.

**The login screen owns the mode.** A new link (pasted, or by the shortcut)
is taken only until the login is accepted: from then on the shortcut does
nothing and is left to the game, so it cannot replace an open NPC input box
nor send the next map server's socket to a bot. Back on the login screen after
a failure, a new link is taken again. Once given, the mode holds for every
server entry of the list until the tab is closed.

## The sockets

`Network/RemoteBot.js` joins the room with `max: 2` (the bot and this window).
`NetworkManager.defaultSocketFactory` returns a remote socket while the mode
is on. Both ways of building a socket reach it: `connect()` calls the module's
own default, and the native plugin manager's socket observer, which installs
its own factory, builds its sockets through `Network.defaultSocketFactory`.
A factory set from outside with `setSocketFactory` alone would be replaced by
the observer's.

The library gives one reliable, ordered message stream per peer (and an
unreliable one, unused here); it refuses any other channel. So the window's
three sockets share the reliable stream as records
(`SocketHelpers/RtcFrames.js`), little endian:

```
[type u8][sid u16][len u32][payload]      type: 1 OPEN, 2 DATA, 3 CLOSE
```

- The window picks the socket id and sends OPEN; either side ends a socket
  with CLOSE (empty payload).
- One message is in flight at a time; what is written meanwhile leaves in the
  next one. A message never exceeds 1 MiB (the library's limit); a larger
  payload is split into several DATA records, in order.
- A truncated record cuts the peer. A record for an unknown socket id, or a
  text message, is dropped.
- A gone peer ends every socket (`onClose`), as a closed WebSocket would. If
  the peer refuses a send, the writes stop until its `close` comes.

The bot holds the same format (`src/Node/spectate/rtc-frames.js` in
roBrowserLegacy-Node). One vector, generated from the bot's implementation,
pins it on both sides: `tests/fixtures/rtc-frames-vector.json` here,
`tests/node/fixtures/rtc-frames-vector.json` there, with a test on each side
(single records, an empty CLOSE, a coalesced run, the 1 MiB edge). Change the
format on both at once, or the vector fails.

`onComplete` is answered on the next tick at the earliest: `connect()` sets it
after the factory has returned. A socket asked for before the bot's peer is
there waits for it, up to 15 s.

## Encryption

The zone socket skips `PacketCrypt.init()` in the mode, whatever `packetKeys`
the server entry holds: the window sends in clear and the bot encrypts with
its own key stream, as the server expects from its session. Setting
`packetKeys` in the config would not do it, since `Configs.get` reads the
server entry before the globals.

## When the bot cannot be reached

The login failure box says why instead of the generic message:

| what the player reads | when |
|---|---|
| no bot answered | no peer within 15 s: the bot is not running, or the link is not its current room **or secret** (a well-formed wrong secret leads to another room) |
| the secret in this link is not valid | `secret`: a malformed secret |
| the relay refused the key | `key` |
| another window is already attached | `room-full` |
| the relay cut this window | `rate` |
| the link is not valid | `options` |
| cannot reach the relay (code) | any other code that ends the room, e.g. `relay` |

Every code that ends the room is final for that link: the link is forgotten
from the tab, no socket opens on it any more, and the login is not retried
automatically (a relay counts repeated key faults against the address and
bans it). A new link on the login screen starts over. « No bot answered » is
the one failure that keeps the link and lets the automatic retry run: the bot
may be starting.

## The library

`src/Vendors/signal/` is the browser build of `@meitogi/signal`, copied
unchanged from a release tag (`VERSION` names it): the browser entry and its
relative imports only, MIT (`LICENSE`). It is vendored rather than an npm
dependency so the Pages build fetches nothing from GitHub. Bumping is copying
again from a newer tag.
