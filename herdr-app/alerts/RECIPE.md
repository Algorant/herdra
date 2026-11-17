# Alerts

Herdr's desktop notifications in **Hokum** (Algorant's desktop notification daemon). Two parts:

- **The Needs-you desk** (task-64, direction B, picked by Algorant 2026-11-05; Sideshow session UuiG39o-3S8): what Herdra tracks for Algorant in herdra-open becomes cards, the same list as Herdra's reply footer and the Herdra window.
- **The mirror** (task-59, direction A, Sideshow post TxwOu0ok6Gc): Herdr's own agent alerts, forwarded as they are. Herdr's sound is unchanged; its in-window toast for them is hidden (task-76, [toast](../toast/RECIPE.md)).

## What you see

**Needs-you desk**

- **One card per open herdra-open item in Needs you** (section `you`: `on: algorant`, not parked, no `--needs`). The card (task-79, option B, picked by Algorant 2026-11-06): app name "<Kind> · <Project>" (no kind: "Needs you · <Project>"), title = the item's `what` (the ask, nothing added), body = its `rec` verbatim ("A. …"; none when the item has none). No ids, no "needs you:" prefix. With the [Hokum card rules](hokum-cards.kdl) applied it is a stripe in the kind's colour (Decide amber, Approve teal, Check violet, Read and no kind grey, Done green), a small ram icon, a `KIND · PROJECT` label, the title and the recommendation in a tinted RECOMMENDED box; without them it is Hokum's plain card with the same texts.
- **Hokum's default timeout (~6 s), normal urgency:** every card, desk or mirror. Algorant 2026-11-06: "Just make everything the default 6 second. don't make something until dismissed unless I explicitly ask for it". The item itself stays in the footer and the Herdra window. Normal urgency never breaks through Do Not Disturb; Hokum holds the card until DND ends.
- **Buttons:** **Open post / Open task / Open agent** (named for the link it follows) follows the item's first `post` link (opens the Sideshow page in the browser), else its `task` link (raises Herdr and opens the Herdra window, whose Needs-you list holds the item), else its `agent` link (raises Herdr and shows that agent). **Jump to Herdra** raises Herdr and shows the terminal `herdra`. An item with no link gets only Jump to Herdra. Clicking the card does what the first button does.
- **An updated item** (new what, rec, kind or link) replaces its card in place.
- **Closed:** the card becomes app "Done · <Project>", title the close note, body the item's what, with the default timeout. **Moved off Algorant** without closing (to a Ceph, to Herdra, parked): the card closes.

**Mirror** (task-59, filtered and worded by task-108)

- **Needs you:** an agent turns `blocked` and its tab isn't the shown one (or the Herdr window isn't the active window). Looking means `window().active` and the agent's tab is `focused().tab`; every agent in the shown tab counts as seen. The body is the question it waits on: the `msg` of its OSC 7501 report (`terminals()[].report.msg`; Pi puts the dialog's title or ask_me's question there).
- **Finished:** an agent turns `done`. In `agents()` that already means "finished while you weren't looking" (it becomes `idle` once looked at), so there is no extra rule. **Only for a turn Algorant started:** a Pi labels its terminal `pi.turn` = `person` (his prompt) or `agent` (an inbox message or report started it). `agent` posts no card (and closes the agent's earlier card); `person` posts one whose body is the agent's own one line, the label `pi.say`. See *Why notifications are filtered*.
- **Fallback:** an agent without the labels (other programs; Pis until .pi's task-640 is loaded) or without a question gets today's body, "<program> · <space> › <tab>", and every `done` still posts.
- **Late words:** when `pi.say` or the question changes while the card is up (the agent still `done`/`blocked`), the card is replaced with the new text.
- **One card per agent.** A new alert for the same agent replaces its card (`replaces_id`). When the agent leaves blocked/done (working, idle) or disappears, its card is closed with `CloseNotification`.
- **The card:** summary "<name> needs you" / "<name> finished"; name is the agent's `whois` label. Body the question / `pi.say` above (escaped for Hokum's markup), else "<program> · <space> › <tab>", prefixed "<machine> · " for an agent on another machine. Normal urgency, Hokum's default timeout (6 s). Click runs `herdr-jump <address>`.
- Nothing else is a card: Ceph, manus and helper messages and inbox traffic never are (Herdra digests them).

Herdr's own in-app toast for the same alert is hidden by the [toast](../toast/RECIPE.md) mod (task-76), so the Hokum card is the only one; `init` also runs `herdr-app/toast/install`, which keeps that copy in place after every app start.

Every card carries the ram icon (`app_icon` and hint `desktop-entry` = `herdr-app`). Mirror cards keep the app name "Herdr"; desk cards use the kind/project app name above.

Wording for `herdra-open`: `what` is the ask in one sentence of about 55 characters or fewer (no project, no task number, no topic prefix, no "needs you"); `--rec` is the short answer of about 40 characters or fewer starting with its option letter (`A. Delegate by default`); context goes in `--ask` and the Task in `--link task=…`.

## Why notifications are filtered

Algorant picked this (task-108, option C, 2026-11-09): "ok lets go with C along with some kind of memory snippet attached to herdr or herdra as far as the reasoning behind it and why". Proposal and mockups: Sideshow session `bcQYfuJdkMM`, `research/task-108.md`.

- **What's silenced:** "finished" cards for turns an agent started rather than him, i.e. a Ceph ending its turn after reporting to Herdra, answering Herdra, or acknowledging a reload, and Herdra's own turns digesting those reports. On 2026-11-09 that was about 100 a day (by 13:23: 83 results, 12 questions, 28 reload acks to Herdra), each one a bare "<Ceph> finished" card.
- **Why:** those cards said nothing ("home Ceph finished"), and Hokum shows 3 cards at a time, so they pushed his real Needs-you desk cards into "N more". The reports themselves already reach him through Herdra: Herdra reads every Ceph report, puts anything that needs him on the Needs-you desk (its own card) and folds the rest into its digest. A card per report was the same news twice, with less in it.
- **What still notifies:** every needs-you desk card and its Done card; every agent blocked on him ("needs you", with the question); "finished" for a turn he started himself and walked away from, with what the agent said; and anything without the labels, as before.
- **Print progress** (3dp print-watch) is not a desktop card: it reports to the 3dp Ceph's inbox, and he sees it in Herdra's updates and the footer.
- **Changing it:** the filter is `alertCard()` in `main.js` (`pi.turn === "agent"` → no card); the labels are .pi's (pi-herdr, task-640). Undo is `git revert` of the task-108 commit.

## How it behaves

- **A 0px block, no window.** It renders an empty `div()`.
- **The desk reads Herdra's list from the machine that owns it.** On workstation, the mod reads `herdra-open list --json --closed 24h` locally and `watchFolder(~/.local/state/herdra)` refreshes it when `open.jsonl` changes. On a second machine, `machines()` detects the connected machine named `desktop`; the mod runs that same command through `hc exec --on desktop` and refreshes it every 2 seconds alongside the mirror. The remote path never falls back to the second machine's local list: an unreachable workstation produces one logged error until a read succeeds.
- **Desk state** is `item id → {card id, shown}` at module level, where `shown` is the posted card's content. At start every Needs-you item posts (that is the desk); closed items seen at start post nothing.
- **Stack tag per item:** every desk card carries `x-canonical-private-synchronous` = `herdra-open:<id>`, so a card replaces the item's earlier card even after a mod reload or app restart lost its id (verified: a second post with the same tag replaces the first). Needs-you cards are `transient`, so a Hokum restart doesn't bring back stale ones; the mod posts them again.
- **The mirror** only reads `agents()`, `terminals()`, `window()` and `focused()`, which rerun `render` on every live change. The first render only records statuses, so agents already blocked or done when the app or mod starts never post; an agent that appears later is recorded without posting too. Sub-agents (terminals with a `parent`) are skipped; remote agents (`machine/t3`) are handled like local ones.
- **Posting is `busctl`, as `omarchy-notification-send` does it:** `busctl --user -- call … Notify susssasa{sv}`, each value one typed D-Bus argument; hints `urgency` (byte 1), `desktop-entry`, `omarchy-exec-argv` (the click, a JSON argv) and, on desk cards, `omarchy-actions` (the buttons, a JSON list of `{label, argv}`) and the stack tag. Hokum 0.1.3 runs those argvs directly, without a shell, for unsandboxed senders only. The body is escaped for Hokum's body markup. The returned `u <id>` is kept for replace and close.
- **Each card's posts and closes run in order** (a queue per agent or item, one `cx.spawn` task at a time).
- **The helpers are found at `~/.config/herdr-app/mods/alerts/`**, the install path. Both add `~/.local/bin` to `PATH` because Hokum starts them without a login shell.
  - `herdr-jump <address or hc name>`: resolves the name with `hc get` (so `herdra` stays right when its address changes), focuses the `herdr-app` window with `hyprctl dispatch`, then `herdr-app do agent.focus --terminal <address>`.
  - `open-item <kind> <target>`: `post` → `xdg-open`; `agent` → `herdr-jump`; `task` → raise Herdr and `herdr-app do mod.open --name herdra` unless the Herdra window is already open (`mod.open` toggles).

## Hokum card rules

`hokum-cards.kdl` holds the two templates (`need`, `done`) and the six rules (one per kind, no kind, Done) that draw the stripe, kind label and RECOMMENDED box. It is Hokum config in Algorant's desktop dotfiles, so Herdra only delivers it: the owner of `~/.config/hokum` (algOS) applies it.

- **Install:** append the file's contents to `~/.config/hokum/config.kdl` (or into `themes/verdigris-capsule.kdl`; both accept `template` and `rule`), run `hokum check` (must say OK), and Hokum redraws within a second. Check with the next Needs-you card or by posting one by hand.
- **Colours** are Verdigris literals (goldenrod `#b8863b`, teal `#5aa0a3`, ink-violet `#8989b0`, vellum grey `#a89984`, green `#8ec07c`) that don't change with light/dark appearance; the desktop runs dark.
- **Caveat:** the label is the card's *app name*, so Hokum's settings window (Applications page) lists apps like "Decide · herdra" and "Check · verdigris", one per kind and project it has seen this session. Per-app mute or timeout rules there would apply to one such name only; the rules here match the prefix and are unaffected. Hokum keeps no history across restarts.
- **Until applied** the cards are Hokum's plain card: the ram icon, header "Decide · herdra" (raw project name, no colour), the title, and the recommendation as a muted line under it, then the buttons. Readable, just not coloured or boxed.

## Built from

- `hokum-cards.kdl` (Hokum templates and rules, applied by hand, above).
- `mods/alerts/main.js`, `mods/alerts/mod.json` (`{"place":"none","title":"Alerts"}`), `mods/alerts/herdr-jump` and `mods/alerts/open-item` (executable).
- The block comes from `herdr-app/sideshow/layout/apply.py`: with `<home>/mods/alerts` present, the tab row ends in `{"id":"alerts-listener","type":"block","size":{"px":0},"content":{"mod":"alerts"}}`. It sits inside the 42px tab row, after the Sideshow button, and shifts nothing.
- Install: `ln -s <checkout>/herdr-app/alerts/mods/alerts ~/.config/herdr-app/mods/alerts`, then `python3 herdr-app/sideshow/layout/apply.py`. The layout names the mod, so install first and apply after.

## Watch out

- **The mirror runs on a 2 s timer as well as on render.** A mod's `render()` runs only while the Herdr window is drawn, and a window on another workspace or behind others is not drawn: exactly when an alert matters. Until task-84 the mirror ran in `render()` only, so it was silent whenever Herdr was out of sight.
- **Runs programs:** `busctl` (posts and closes), `whois` (the card's name), `herdra-open list` (on each local `open.jsonl` change, or every 2 seconds from workstation on a second machine) and, on a click, `hyprctl`, `hc`, `herdr-app` and `xdg-open`. On a second machine, `hc exec --on desktop` reads the list; it does not use that machine's local `open.jsonl`. It reads agent names and places and the herdra-open list, nothing else.
- `watchFolder` watches only the local state directory. On a second machine the desk list still comes from workstation, using the connected machine named `desktop`; remote changes are picked up on the 2-second refresh.
- **Retargeting the symlink doesn't reload the mod.** The app watches the `mods/` entries, not where a symlink points; after relinking `mods/alerts`, switch layouts (`herdr-app do layout.switch --name main`, then `--name main-sideshow`) to start the new copy. Saving a file in the linked folder does reload it.
- Hokum holds normal-urgency cards while Do Not Disturb is on; neither desk nor mirror cards are critical.
- `window()` is null under `herdr-app check`, so the mod reads it as `window()?.active`.
- Hyprland 0.56 takes Lua dispatchers: `hyprctl dispatch 'hl.dsp.focus({ window = "class:herdr-app" })'`; the old `focuswindow class:…` syntax is an error.
- Mirror cards that were open when the mod reloads stay until they time out; the reloaded mod does not know their ids. (Desk cards don't have this problem: the stack tag.)
- A desk card whose item closed while Herdr wasn't running stays until dismissed: the mod sees the item already closed at start and posts nothing for it.

## Undo

Cards: `git revert` the task-79 commit (the old "<Project> needs you: …" texts return) and delete the Hokum rules block (everything copied from `hokum-cards.kdl`); the mod works with or without the rules, so the order doesn't matter. Mod: remove the block (`rm ~/.config/herdr-app/mods/alerts`, then `python3 herdr-app/sideshow/layout/apply.py`, which leaves it out when the mod is absent), or `git revert` the commit and reapply. Herdr's own sound never changed; its toast is the [toast](../toast/RECIPE.md) mod's (undo there).

## Done when

- `herdr-app check ~/.config/herdr-app/mods/alerts` passes.
- With `dbus-monitor --session "interface='org.freedesktop.Notifications'"` running, `herdra-open add --on algorant … --rec "A. …" --link post=… "what"` posts app "<Kind> · <Project>", title `what`, body `rec` (urgency byte 1, timeout -1, the stack tag, `omarchy-actions` Open <kind> and Jump to Herdra); an `update` of it posts again with the same id; `close` posts app "Done · <Project>", title the note, with the same id and timeout -1.
- Open on a post card opens the post; Jump to Herdra shows `herdra`; `hokum invoke` runs the first button.
- For the mirror: an agent in a tab that isn't shown turning `blocked` posts "<name> needs you"; turning `working` sends `CloseNotification` for that id; turning `done` posts "<name> finished"; nothing posts for agents already blocked or done at start.
- task-108: with `pi.turn=agent`, `done` posts nothing; with `pi.turn=person` and `pi.say=<line>`, `done` posts "<name> finished" with body `<line>`, and a later `pi.say` change replaces it; `blocked` with a 7501 `msg` posts that question as the body.
