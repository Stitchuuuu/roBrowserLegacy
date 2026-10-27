# Remote bot: the game window on a running bot's session

The remote mode attaches the game window to a headless client (a
roBrowserLegacy-Node bot started with `--spectate-rtc`) instead of a game
server. The bot stays logged in; it answers the window's login, char and zone
handshakes from its own session, replays a snapshot of the map, then forwards
the live packets both ways. Nothing here is from the original client: it is a
feature of this port.

## Opening it

| page | what happens |
|---|---|
| `api.html?app=ONLINE#remote&r=<room>&s=<secret>&relay=<wss url>[&key=<relay key>]` | joins the bot's room at once |
| `api.html?app=ONLINE#remote` | reuses the link kept for this tab, or opens the paste box on the login screen |
| `Alt+Shift+R`, any time before the first connection | opens the paste box |

The parameters are the `@meitogi/signal` link format (`parseLink`): `r` the
room, `s` the room secret (43 base64url characters), `relay` the signaling
relay, `key` the relay's application key. The paste box takes a whole link or
only what follows its `#`.

Once read, the link is kept in `sessionStorage` (`remoteBot`) and the address
bar is reduced to `#remote`: a reload in the same tab attaches again, closing
the tab forgets the link, and a bookmark of the page carries no secret.

What the link gives away: whoever has the **secret** can attach to the bot,
and play its character once control is taken. The **relay key** only spends
the relay's bandwidth. The part after `#` never reaches a web server, but it
stays in the browser history and in anything the link is pasted into.

The mode is fixed by the first game socket: after it, the shortcut and the
paste box do nothing.

## The sockets

`Network/RemoteBot.js` joins the room with `max: 2` (the bot and this window).
`NetworkManager.defaultSocketFactory` returns a remote socket while the mode
is on. Both ways of building a socket reach it: `connect()` calls the module's
own default, and the native plugin manager's socket observer, which installs
its own factory, builds its sockets through `Network.defaultSocketFactory`.
A factory set from outside with `setSocketFactory` alone would be replaced by
the observer's.

The library gives one reliable, ordered message stream per peer and refuses
any other channel, so the window's three sockets share it as records
(`SocketHelpers/RtcFrames.js`), little endian:

```
[type u8][sid u16][len u32][payload]      type: 1 OPEN, 2 DATA, 3 CLOSE
```

- The window picks the socket id and sends OPEN; either side ends a socket
  with CLOSE (empty payload).
- One message is in flight at a time; what is written meanwhile leaves in the
  next one. A message never exceeds 1 MiB (the library's limit); a larger
  payload is split into several DATA records, in order.
- A malformed message cuts the peer. A gone peer ends every socket
  (`onClose`), as a closed WebSocket would.

The bot holds the same format. `tests/fixtures/rtc-frames-vector.json` is
committed in both repositories with a test on each side: change the format on
both at once, or the vector fails.

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

| cause | library code |
|---|---|
| no bot answered in the room within 15 s | — |
| wrong secret | `secret` |
| relay key refused | `key` |
| another window is already attached | `room-full` |
| relay busy | `rate`, `banned` |
| invalid link | `options` |

A refused key or secret closes the room for good: nothing is retried until a
new link is given. A relay counts repeated key faults against the address and
bans it.
