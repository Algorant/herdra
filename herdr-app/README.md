# Herdr app mods

Algorant's own mods for the Herdr desktop app, one folder each, laid out the
way herdr.dev shares them: `mods/<name>/`, a `RECIPE.md`, a `preview.png` and
any `keys.json` snippet. The live copy is in `~/.config/herdr-app/mods/<name>/`.
Install or update one with `cp -r <name>/mods/<name> ~/.config/herdr-app/mods/` (toast: `toast/install`),
then `herdr-app check ~/.config/herdr-app/mods/<name>`. Merge its `keys.json`
into `~/.config/herdr-app/keys.json` by hand.

Each machine's `~/.config/herdr-app/mods/<name>` points into that machine's own
`~/Projects/herdra` checkout, so a merged change is live only where that checkout has it (task-133).
Nothing has to remember: `.config/wt.toml`'s post-merge hook runs `bin/herdra-mods-sync` on the
machine whose `main` moved, which pushes that `main` to every connected machine and merges it into
the checkout there (the commits come from the merging machine, not from origin: a merge is real
before it is pushed, and the app loads the checkout, not GitHub), and `bin/herdra-online <host>` runs
the same sync when an away machine reconnects. Worktrunk needs that one hook command approved once
per machine (`wt config approvals add --yes` in the checkout); unapproved, `wt merge` stops in a
non-interactive run.

Testing a mod never changes what Algorant sees: no `tab.new`, `space.new`, `space.select` or
focus in his window. Start a test agent with `hc run --bg … --label herdr.space=<space>` (no
`herdr.tab`), open an overlay only for the one capture and close it straight after, and remove any
test space or terminal before finishing (task-61). Check a change on the machine whose Herdr app
Algorant is using, and know that `herdr-app shot` returns a stale frame while the window is covered.

- [sideshow](sideshow/RECIPE.md): one Sideshow session as a running thread — its posts newest
  first with their rounds and comments, a picker for the other sessions, and a local
  archive (task-114, replacing task-50's feed) in a floating right-hand window
  (task-46-14). Its `layout/apply.py` builds the
  `main-sideshow` layout, whose tab row holds the Herdra, Usage (the
  [usage](usage/RECIPE.md) mod) and Sideshow buttons.
- [herdra](herdra/RECIPE.md): the Herdra button and window, opening at once on
  work in flight, what needs Algorant and recent results (task-46-5, task-51).
- [alerts](alerts/RECIPE.md): Herdr's own agent alerts (needs you, finished) forwarded to Hokum, the
  desktop notification daemon, one normal-urgency card per agent, click to jump (task-59). A 0px
  block in the tab row; no button, no window.
- [toast](toast/RECIPE.md): Herdr's own toast mod with agent alerts (needs you, finished) left out, so they show in Hokum only
  and not twice (task-76); installed over the shipped one by `toast/install`, which the alerts mod runs after every start.
- [usage](usage/RECIPE.md): the four subscription plans (Codex, Claude, Grok,
  OpenCode Go) with their account limits, plus tokens by day and by model, in a
  window under the Usage button; it has its own collector, run when the window opens (task-52).
