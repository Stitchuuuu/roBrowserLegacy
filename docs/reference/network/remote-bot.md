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

## Remote characters: the account's hall

Instead of a link per bot, the login screen can list every remote client of
the account and attach to the one picked. Each bot sits in the account's
**hall**: one room named by the `spectate` block of its config (relay, relay
key, room, secret — the same block in every bot of the account). The block is
written by `/remote <hall link>` typed in the bot's console (the line « Copy
for clients » copies, the library's link format); a bot with a saved hall
joins it at every start, `--spectate-rtc` or not.

| screen | when |
|---|---|
| **Remote connections** (`UI/Components/RemoteSettings`) | relay, relay key, hall, secret, kept in `localStorage` (`botHall`) until « Forget ». « New » draws a secret, « Copy for clients » copies `/remote <hall link>` for each bot's console |
| **Remote characters** (`UI/Components/RemoteCharacters`) | the login screen once settings are saved: one row per remote client, « Normal login » for the usual window |
| « Remote characters » button (`UI/Components/RemoteEntry`) | above the usual login window, once this browser has a relay: the list, or the settings the first time |

`Network/BotHall.js` joins the hall when the list shows (never at load) and
leaves it once the login is accepted. Everyone joins with `connect: 'manual'`
and `max: 40`: the page calls each member, bots call nobody, so no two bots
are linked (a library room is otherwise a full mesh). `max` counts every
member, linked or not, and the relay caps it (`RELAY_ROOM_MAX`); each bot
holds one relay connection, so a machine with N bots and W open windows uses
N + W of the relay's per-address connections (`RELAY_IP_CONN`).

The button stays hidden for whoever never used the mode. A relay is given by
a page opened with `?relay=<wss url>[&key=<relay key>]` (both leave the
address bar), or by a bot link; it is kept in `localStorage`
(`botHallRelay`), fills the empty settings, and goes with « Forget ». Every
way back to the login window (Cancel on the char server list, a ban) passes
through the same screen, so the button comes back with it.

The way back follows how the player logged in: through a remote client, the
remote characters; by hand (« Normal login », or the login window with no
hall), the login window and its button — after an exit, a disconnection or a
ban alike. The button, or a fresh page, goes back to the list.

What the hall secret gives away: whoever has it lists the account's remote
clients **and opens any of them**. Every build served from one origin reads
the same `localStorage`.

### The hall's messages

JSON text, `Network/HallMessages.js` here and `src/Node/spectate/hall-messages.js`
in roBrowserLegacy-Node:

| page → bot | bot → page |
|---|---|
| `{t:'who', v:1}` | `{t:'hello', v:1, kind:'node', account, chars:[{name, job, lv}], playing:{name, job, lv, map} \| null, windows}` |
| `{t:'open', v:1, id}` | `{t:'room', v:1, id, room, secret}` or `{t:'no', v:1, id, why}` (`busy`, `error`) |

- The bot sends `hello` again, unasked, when its map or character changes.
- Every field is bounded (names 32 characters, 15 characters per account,
  ids up to 2³¹-1, 8 KiB per message). An unknown `t` is ignored, so a newer
  side can add requests; anything else that does not fit cuts that peer only.
- An answer settles an `open` only from the bot it was asked of; none within
  15 s rejects it, and so does the bot leaving the hall or the hall closing.
- The page calls every member on each change of the member list; a link that
  fails is tried again on the next change, a cut link is called again while
  its bot is still a member, and every new link is asked `who`.
- One vector pins the format on both sides: `tests/fixtures/hall-vector.json`
  here, `tests/node/fixtures/hall-vector.json` there.

### Opening one

`open` makes the bot join a **fresh** room (a new name, a new secret,
`max: 2`) and answer once it is in it. `RemoteBot.useRoom()` joins that room
with the hall's relay and key; the secret never goes through the address bar
and nothing is kept for a reload (the room is the bot's to leave: when its
window goes, or after a minute with nobody). A second window on the same bot
gets its own room. The login then runs by itself with dummy credentials (the
bot answers with its own), the one char server is entered without its list
(in the remote mode a bot always answers with the one it plays on, from a link
too), and the character the bot plays is picked by name
(`RemoteBot.takeCharacter()`, `CharEngine` — once: back at the character select, the player picks). An answer that comes once the list is
gone (the player opened Settings meanwhile) is dropped.

What the list says when it cannot show remote clients, or one does not open:

| what the player reads | when |
|---|---|
| Entering the hall… | the hall is being joined |
| Calling the remote clients of the hall… | members are there, none has said `hello` yet |
| No remote client in this hall… | nobody else in the room: no bot runs, or the hall or secret differ (a wrong secret leads to another room) |
| The relay refused the key / The hall secret is not valid / These settings are not valid | `key` / `secret` / `options` closed the hall |
| The hall is full / The relay cut this window | `room-full` / `rate` |
| Cannot reach the relay (code) | any other code that closed the hall |
| This remote client has too many windows open | `no`, `busy` (four windows per bot) |
| This remote client left the hall | `gone`: it left, or the hall closed, while asked |
| This remote client did not answer | no answer within 15 s |
| This remote client could not open a room | `no`, `error`: its fresh room failed |

« Normal login », or a login screen without hall settings, leaves a room the
list opened, so a real login reaches the real server; a pasted link stays.
Back from the character select to the login screen, the mode takes a new room
or link again.

## The sockets

`Network/RemoteBot.js` joins the room with `max: 2` (the bot and this
window), from a link or from the list.
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

## NPC dialogs

The bot answers its NPCs; its answers (`CZ_REQ_NEXT_SCRIPT`, `CZ_CHOOSE_MENU`,
`CZ_CLOSE_DIALOG`, the input boxes) are client packets and never reach the
window, which only gets the server's pages. The original client clears a page
on its own Next click and closes on its own Close click, so a window that
reacted only to its own clicks would pile every page up in one box that never
closes. In the mode (`Engine/MapEngine/NPC.js`, `RemoteBot.isActive()`), the
window reacts to the packets instead:

| packet | in the mode |
|---|---|
| `ZC_WAIT_DIALOG`, `ZC_MENU_LIST` | the page is complete (`NpcBox.endPage`): the next text clears the box and hides the Next button |
| `ZC_SAY_DIALOG` | an open menu or input box goes away first — the bot answered it |
| `ZC_CLOSE_DIALOG` | the box and its menu close at once, no Close button |

A window that holds `@control` plays through the same box: its own Next and
menu still send their packets. A `close` / `close2` closes its box too, without
the `CZ_CLOSE_DIALOG` the script waits for (rathena `buildin_close`: the script
goes on when Close is pressed) — known gap, the window cannot tell whether it
holds control.

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
