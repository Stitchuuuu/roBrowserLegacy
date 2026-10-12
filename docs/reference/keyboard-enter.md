# The Enter key

Introduced by `f53c4333` (Enter activates a keyboard-focused button), narrowed
by `c9f17877` (not a button focused by a click).

## Rules

- **Enter belongs to the chat.** Outside a text field, Enter shows the chat
  input and focuses it; in the chat input it sends the message.
- **Enter never opens or closes the inventory.** The inventory shortcut is
  **Alt+E** by default (`ShortCutControls.js`).
- **A button reached with Tab activates on Enter.** ChatBox yields Enter to a
  focused `<button>` outside its own root, so keyboard users can operate the
  client's buttons.
- **A button focused by a mouse click does not.** A click leaves the DOM focus
  on the clicked button, so without this every Enter after clicking a menu
  entry - Basic Info's Inventory, Equip, Skill... - clicked it again and the
  chat never took the focus. The click is remembered on `pointerdown` and
  forgotten on the next Tab.
- **Space is left to the browser.** A button activates on Space keyup, which
  ChatBox does not handle, so Space still activates a clicked button.

## Why

All three client builds handle Enter the same way, and none of them reaches
the inventory:

- ver12: the key handler `fcn.004e8010`, `case 0xd`, toggles the chat /
  battle-mode flag, then `fcn.004df630` sends the default ("OK") message to
  the first open window of a fixed list of dialog slots. The inventory slot
  (`+0x8c`) is not in that list.
- 2022: `fcn.0063ca70`, `case 0xd` -> `fcn.00629ad0`.
- mars26: `fcn.008f1fd0`, `case 0xd` -> `fcn.008ddc50`.

Alt+E in ver12 is `case 0x45` of the same handler with Alt held: it presses
Basic Info's button `0x80`, which toggles the inventory.

## Deviations

- **Tab + Enter on a button.** The original client has no keyboard focus on
  its buttons, so this is an addition for keyboard users, not a port.
- **`:focus-visible` is not used to tell the two foci apart.** It looks like
  the right test, but in Chromium a mouse-focused button already matches
  `:focus-visible` inside the capture-phase keydown handler for that very
  key: any keydown flips it before dispatch. Measured with trusted input on
  Chromium 154. Hence the explicit pointer flag.

## See also

- `git show f53c4333` (Enter on buttons), `git show c9f17877` (the click case)
