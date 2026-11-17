# Toast

Herdr's `toast` mod (how notifications look) with one change (task-76): **an agent alert is not drawn.**
Herdr posts "<agent> needs you" and "<agent> finished" as an in-app toast, and the [alerts](../alerts/RECIPE.md)
mod posts the same alert as a Hokum card; Algorant got both. Now only Hokum shows it.

## What you see

- **Agent needs you / finished:** the Hokum card only, no toast in the Herdr window. Herdr's sound is unchanged.
- **Everything else** (a failed command, a script exit, an error, an update notice): the toast, as before.
- **Sub-agents** (Workers and helpers, terminals with a parent) still toast: the alerts mod doesn't mirror them to Hokum, so hiding theirs would lose them.

## Why a mod, not a setting

Herdr 0.1.13 has no setting for it: `sounds.enabled` only gates the sound, and Settings > Alerts says "A note
shows in the corner either way". Notifications are always drawn by the mod named `toast`, and only that mod can tell
an agent alert (action `agent.focus {terminal}`) from other toasts, so the filter is a change to it.

## How it survives restarts and updates

Herdr restores its own `toast` at every app start, and after an update. A changed file would be moved aside to
`toast-edited`; recording its hash in `installed.json` makes it a silent replacement instead. So:

- `herdr-app/toast/install` copies `mods/toast/{main.js,mod.json}` to `~/.config/herdr-app/mods/toast/` and writes their FNV-1a 64 hashes into `installed.json`. Idempotent.
- The alerts mod runs it in `init`, after each start, and the mod reloads on the file change. Between app start and then, Herdr's own toast is in place for a moment (nothing alerts at start).
- It is Herdr 0.1.13's toast plus the filter (`agentAlert` and `init` in `main.js`, marked `herdra:` at the top). If a later Herdr changes its toast, re-base: copy its new `~/.config/herdr-app/mods/toast/main.js` (right after a restart, before the alerts mod reinstalls ours; or from a scratch `HERDR_APP_HOME`) and re-add the filter.

Install: `herdr-app/toast/install`, then `herdr-app check ~/.config/herdr-app/mods/toast`.
laptop gets it with its next catch-up of this repository (and a restart or reload of the alerts mod).

## Undo

1. Remove the reinstall: `git revert` the task-76 commit (it removes `herdr-app/toast` and the `TOAST_INSTALL` lines in the alerts mod), and `/reload`/restart so the alerts mod stops calling it.
2. Put Herdr's own toast back at once: `rm -rf ~/.config/herdr-app/mods/toast`, then restart the Herdr window (terminals keep running; Herdr installs its toast at start). Until the restart, no toasts at all.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/toast` passes.
- A real agent turning done or blocked in a tab not shown: the Hokum card appears and no toast does (`herdr-app status` lists no `toast` overlay).
- A toast without the `agent.focus` action (a failed command) still appears.
- After a Herdr restart the alerts mod reinstalls this copy (`grep agentAlert ~/.config/herdr-app/mods/toast/main.js`), and no `toast-edited` appears.
