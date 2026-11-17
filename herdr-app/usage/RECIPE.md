# Usage

A **Usage** button in the tab row and a window under it showing the four subscription plans (Codex, Claude, Grok, OpenCode Go): provider tabs, the plan, account limits with their resets, tokens by day (seven thin rows, today bold) and tokens by model. Look: algOS's Omarchy `Panel.qml`, approved as option A in Sideshow post tRMW1N20RTE (task-52). It has **its own collector**, `collect.mjs`, which fetches the plan limits independently of any Pi conversation. There is no background schedule: it fetches when the window opens (a provider at most every 3 minutes) and when you press Refresh. Pi's `/limits`, the powerbar and the Omarchy bar are untouched and keep their own code.

No `preview.png` yet: the live screenshot is taken by Herdra after deployment.

## What you see

A frameless window (theme `background`, 1px `border`, radius 10), 420px wide, opened by the button, `ctrl-shift-u` or `herdr-app do mod.open:usage`. Its top is on the pane cards' top line (tab row height plus the work area's padding), its bottom above the status bar (at most 880px tall), and its right edge on the Usage slot's right edge, computed from the shown layout and the viewport the way the Herdra and Sideshow windows are (the tab row's right edge less the buttons after Usage); event bounds are not used. It stays until the button is clicked again or Esc is pressed (Esc works once you have clicked inside the window, as in Sideshow); a click elsewhere does not close it. It never takes the keyboard on opening, so the first press on the button always reaches the button. The hero drags it, and Herdr remembers where it was dropped (`key: "usage"`). It is not `keep: true` (unlike Herdra and Sideshow): it does not reopen on app start, because opening it fetches. The button is lit (`selected`) while the window is open.

1. **Hero**: the provider's mark (34px, drawn in `foreground`), its name (20px) and the plan under it in 11px `dim` capitals (`PROLITE`, `MAX 5X`, `SUPERGROK`). A plan never read shows `PLAN UNKNOWN`; one last read more than a day ago is `muted` with its age. OpenCode Go shows `GO`: the Go usage route answers only a key with a Go subscription (otherwise 403), so a successful read is the plan; no API tells Go from Go Plus or Go Teams, and Algorant's is Go. **Refresh** on the right.
2. **Tabs**: Codex, Claude, Grok, OpenCode; the shown one is filled.
3. **LIMITS · ACCOUNT**, with `as of 3m ago` (`dim`, fresh), `stale · 2h ago` or `unavailable` (both `muted`) on the right. One block per limit window: label and percentage, a 6px bar, and `Resets in 19h 32m · Wed 10:46 AM` under it.
4. **TOKENS BY DAY · DESKTOP**: the last seven local days, oldest first, each a thin bar scaled to the busiest day, value on the right (`1.3M`). Today is bold and in `foreground`; the others are `muted`.
5. **TOKENS BY MODEL · DESKTOP · 7 DAYS**: up to six filled rows (a `selected` fill scaled to the biggest model), then `+ n more`.
6. **Footer**: when it fetches (when the window opens, a provider at most every 3 minutes, and on Refresh).

## Colours

Text and marks use only the theme's UI keys: `foreground`, `muted`, `dim`, with `border`, `hover`, `selected` and `chrome` for surfaces; nothing is hard-coded and `terminal_foreground` is not used. The only other colours are on usage bars and their percentages: `ansi3` (ochre) from 75% and `blocked` (red) from 90%. Stale chips, the unavailable chip, failure notes, the token note, a stale plan label and the read-error line are `muted`. The provider marks (`assets/*.svg`) are `currentColor` glyphs; `svg()` draws them as a mask in the element's text colour (`foreground`), whatever fill the file names.

The two token sections name the host the records came from (the machine whose Pi sessions were scanned), not "this machine".

## Freshness: what a number may be shown as

Computed when drawn, from the record and the clock; one rule for every number.

- **fresh**: fetched at most 10 minutes ago (nothing refetches in the background, so a reading is current for as long as a popup-open fetch plausibly is). Shown with `as of <age>`.
- **stale**: older than 10 minutes but inside the window's display limit (1 h for a window of 6 h or less, or of unknown length; 24 h for a longer one). Dimmed, with `stale · <age>`, plus the last failed attempt and its next retry.
- **unavailable**: no reading yet, or past the display limit, or the collector is paused, or the owner cannot be reached. No number, only the reason: `sign-in needed: /login in Pi on workstation`, `rate limited until 2:20 PM`, `request timed out · next try 2:35 PM`, `cannot read the collector's records: …`, `not collected yet`.
- A window whose `resetAt` has passed shows `Reset <time>, after this reading; current usage unknown` and no percentage.
- Missing data is never 0. A day the scan did not cover shows `–`; a successful scan that found nothing shows `0`.
- Tokens and the plan label follow the same states by their own timestamps.

## How it behaves

- **The key.** `ctrl-shift-u` runs `mod.open:usage`: the 2×2 popup runs the same `toggle()` as the button, then closes itself, so a press opens the window and a second press closes it, as `ctrl-shift-s` does for Sideshow. `keys.json` here holds the snippet to merge into `~/.config/herdr-app/keys.json`: `"global": { "ctrl-shift-u": "mod.open:usage" }`. The key was free in the live `keys.json` and in Hyprland's bindings; **fcitx5's Unicode addon takes it by default** (`DirectUnicodeMode`, "Type unicode in Hex number", on `Control+Shift+U`; its search picker is on `Control+Alt+Shift+U`), so the key never reaches Herdr until that fcitx5 key is moved or cleared (task-74; `herdr-app do mod.open:usage` toggles fine). Herdr's Help overlay (`ctrl-shift-?`) lists it as "mod open usage".
- **The button** runs nothing: `on_click(() => toggle())` opens the window, and a second click closes it. `toggle()` closes the id in shared `usage.window` and clears it, else opens the window; it never writes the id itself. **The window owns the id**: it sets it synchronously in `init`, re-asserts it every 5 s (a hot reload can clear it) unless its `close()` has run, and clears it in `close()` when it still holds this window's id. The button copy clears any id at its own start, when no Usage window can exist, so an id left by a crash cannot survive to make the first press a dead click. Esc closes it too, once the window has the keyboard: it takes it on a press inside the window only, as Sideshow's does, never on opening. The pill's element id is `us-panel-button`, not the layout block id `usage-button`. There is no background schedule and no timer on the button.
- **Opening the window** reads the four records, runs `collect.mjs --open` (a provider is attempted at most every 3 minutes), and re-reads. While open it re-reads every 30 s, which keeps ages and countdowns true but fetches nothing. **Refresh** runs `--refresh` (the same 3-minute floor; it also lifts a sign-in pause).
- The collector runs on the machine named `OWNER` in `data.js` (`desktop`, whose Pi logins are used). On another machine the window reads the records and runs the collector on `OWNER` through hc. If `OWNER` cannot be reached it says so; it never fetches locally in its place.
- A collector failure (for example `node` not found) shows as a `muted` line in the window: `collector failed on workstation: …`.
- The widget reads records and starts the collector. It never fetches usage and never reads credentials.
- Between openings nothing is collected, so the window always shows the age of what it has.

## The collector (`collect.mjs`)

Dependency-free Node, shipped inside the mod folder so one copy deploys both.

| Flag | Meaning |
| --- | --- |
| `--open` | the window opened: each provider at most every 3 minutes; a 429 wait and a sign-in pause are respected |
| `--refresh` | the person asked: like `--open`, and it lifts a sign-in pause (a 429 backoff is still respected) |
| `--dry-run` | prints what would run (auth command, URLs, header names with values redacted, due state); sends, reads from Pi and writes nothing |
| `--dry-run <dir>` | the same code on canned responses `<dir>/<key>.json` (`codex`, `claude`, `claude.plan`, `xai`, `xai.plan`, `opencode-go`); prints the records, writes none unless `--state <dir>` is also given |
| `--state <dir>` | the record folder (default `~/.config/herdr-app/data/usage`) |

A canned file may be a bare response body, or an envelope: `{"__status":429,"__retryAfter":"60"}`, `{"__network":"timeout"}`, `{"__auth":"fail"}`, `{"__raw":"<html>"}`, or `{"__body":{…}}`.

**Caveat.** The collector calls undocumented provider usage endpoints with the client headers those clients send, reads only local credentials through `pi auth`, and may break when a provider changes them.

**Credentials.** Only Pi's documented export, run with `execFile` (no shell): `pi auth print-bearer-token --provider <anthropic|openai-codex|xai> --min-expiry 30m` and `pi auth print-api-key --provider opencode-go`. The value stays in memory: never in a file, log, record or argv. Nothing else is read (not `auth.json`, `~/.claude`, `~/.codex`, `~/.grok`), the collector never signs in, and it never refreshes except through `pi auth`.

**Routes** (the first three are internal and undocumented, used by the providers' own clients and by the widely used usage tools; sources in task-52's plan report):

| Provider | Quota | Plan label | Identity sent |
| --- | --- | --- | --- |
| Claude | `GET api.anthropic.com/api/oauth/usage` | `/api/oauth/profile`, every 6 h | `User-Agent: claude-code/<version from "claude --version">`, `anthropic-beta: oauth-2025-04-20` (a borrowed Claude Code identity; without it the route answers 429) |
| Codex | `GET chatgpt.com/backend-api/wham/usage` | `plan_type` of the same response | `User-Agent: herdr-usage/<version>` |
| Grok | `GET cli-chat-proxy.grok.com/v1/billing?format=credits` | `/v1/settings`, every 6 h | `User-Agent: herdr-usage/<version>`, `x-xai-token-auth: xai-grok-cli` |
| OpenCode Go | `GET opencode.ai/zen/go/v1/usage` | `Go`, from a successful read of the same route | `User-Agent: herdr-usage/<version>` |

There are no runtime fallbacks: a failure is recorded and shown with its reason.

**Limits.** There is no schedule. One attempt per provider per run, no in-run retries. 10 s per request, 1 MB per response, redirects refused, 25 s for the whole run (inside Herdr's 30 s `exec` limit); a provider unfinished at the deadline is recorded as `timeout`. A provider is never attempted within 3 minutes of its last attempt. After a 429 it waits `max(Retry-After, 15 minutes)`, the 15 doubling to 2 hours for consecutive 429s; neither `--open` nor `--refresh` overrides that. Any other failure is simply retried at the next open or Refresh. A sign-in failure (`pi auth` fails, or HTTP 401/403) pauses `--open` until `--refresh`. The token scan runs under the same 3-minute floor.

**Coalescing.** An `O_EXCL` lock file in the record folder (stale after 40 s or when its process is gone). A caller waits at most 6 s, then re-reads the records and skips every provider attempted since it started, so concurrent callers make one attempt, never two in series. When the wait runs out it prints `{"busy":true}` and attempts nothing.

**Records**, one file per provider in `~/.config/herdr-app/data/usage/` (folder `0700`, files `0600`, written atomically):

```json
{ "schema": 1, "provider": "claude", "host": "desktop",
  "plan": { "label": "Max 5x", "fetchedAt": "…", "outcome": "ok", "nextDueAt": "…" },
  "attempt": { "startedAt": "…", "finishedAt": "…", "trigger": "open|refresh",
               "outcome": "ok|rate_limited|auth|http|timeout|network|malformed|unsupported",
               "httpStatus": 429, "detail": "…", "retryAt": "…", "failures": 1, "paused": true },
  "success": { "fetchedAt": "…", "windows": [ { "id": "five_hour", "label": "5h window", "usedPercent": 33,
               "windowSeconds": 18000, "resetAt": "…" } ] },
  "tokens": { "scannedAt": "…", "attemptedAt": "…", "outcome": "ok|error", "source": "pi sessions",
              "days": [ { "date": "2026-11-03", "tokens": 133030632 } ], "models": [ { "model": "claude-opus-5-5", "tokens": 1 } ] } }
```

- `success.fetchedAt` is set only when the provider answered 2xx and the mapper accepted the payload. A write or an exit code 0 is not a success, and a failed attempt never re-dates `success`.
- Resets are absolute `resetAt`; the countdown is computed when drawn. A window length is recorded only when the provider names it (Claude's `five_hour` and `seven_day`, OpenCode's `rolling`, `weekly`, `monthly`, Codex's `limit_window_seconds`, Grok's period); a Codex window without one gets a generic label, never a guessed 5h or 7d.
- A window is a reading whenever it carries a percentage, whatever else the provider says about it: OpenCode marks an exhausted window `"status": "rate-limited"` with `"percent": 100`, and filtering on `status` once hid exactly that window (task-144).
- A missing percentage is dropped, never 0. Grok omits zeros in its JSON, so a period without `creditUsagePercent` is recorded as `unsupported` / `percentage_omitted` and shown as unavailable.
- Records hold only mapped numbers, labels and outcome classes: no tokens, headers, bodies, or account or user ids.

**Token history** is this machine's, from Pi's session logs only (`~/.pi/agent/sessions`, `~/.omp/agent/sessions`; files changed in the last 8 days). Assistant messages are matched by provider: `anthropic` (Claude), `openai-codex` and `openai` (Codex), `xai` (Grok), `opencode-go`. Per local day and per model it sums `input + output + cacheRead + cacheWrite` over seven days. It is scanned with each collector run (under the 3-minute floor) and has its own status. No provider API returns tokens by day, and `~/.claude` and `~/.codex` logs are deliberately not read.

## Built from

- `mods/usage/mod.json`: `{"place":"none","title":"Usage","overlay":{"kind":"popup","frame":"none","width":2,"height":2}}` (the 2×2 popup is the `mod.open:usage` toggle, as in the Herdra and Sideshow mods).
- `mods/usage/main.js`, one `View` with three roles: `props.button`, the `mod.open` toggle, and the window (`props.window`, opened as `kind: "window"`, `key: "usage"`). `herdr`: `theme`, `settings`, `props`, `appHome`, `hc` (`server status`), `exec`, `readTextFile`, `shared`/`setShared` (`"usage.window"`), `openOverlay`/`closeOverlay`. `gpui-kit`: `View`, `div`, `svg`, `cx.timer` (the 30 s re-read), `cx.spawn`, `cx.focus_handle` (Esc). `gpui-base`: `v_flex`, `h_flex`.
- `mods/usage/data.js`: parsing the records and every freshness rule; no Herdr imports.
- `mods/usage/collect.mjs`: the collector.
- `mods/usage/assets/`: the four provider marks (Lobe Icons, MIT, fills set to `currentColor`; see `NOTICE.md`) and `usage.svg` (the button icon, this mod's own; nothing refers to `.pi`'s copy). Herdr draws `svg()` only from real files under `~/.config/herdr-app`, never through a symlinked `mods/usage`, so `installAssets()` (run by the button at init and by the window when it opens) copies them to `data/usage/assets/` (compare first, write only when different) and the marks are drawn from there once the copy exists. If the copy fails the reason goes to the log and no mark is drawn.
- The tab row slot comes from `herdr-app/sideshow/layout/apply.py`: block `usage-button`, 80px, content `{"mod":"usage","props":{"button":true}}`. The mod's name must stay `usage`.

## Install

`~/.config/herdr-app/mods/usage` was `.pi`'s old popup, a symlink into `~/.pi/agent/extensions/pi-ui/herdr-app/usage`. A plain `cp -r` would write into `.pi`'s folder. Remove the symlink first (coordinated with `.pi`), then:

```sh
cp -r herdr-app/usage/mods/usage ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/usage
python3 herdr-app/sideshow/layout/apply.py   # only if main-sideshow has no usage-button yet
```

The first real run (`node ~/.config/herdr-app/mods/usage/collect.mjs --open` on `desktop`) is six provider requests (Claude 2, Codex 1, Grok 2, OpenCode Go 1) plus whatever token refresh `pi auth` does.

## Watch out

- **Reaches the network, runs programs and writes files.** The collector sends the requests above, runs `pi` and `claude --version`, and writes only under `~/.config/herdr-app/data/usage/`.
- **Terms.** The Claude, Codex and Grok routes are internal and undocumented; Anthropic limits subscription OAuth to Claude Code and native apps, and the Claude route needs a Claude Code `User-Agent`. Algorant approved all four on 2026-11-03.
- **Third caller.** Pi turns and the Omarchy bar's 15-minute timer already call the same accounts. This collector adds a third, but only when the window opens or Refresh is pressed (at most every 3 minutes per provider), with the 429 wait above; Anthropic's route has been reported to 429 for hours with no `Retry-After`.
- **Unverified until a real run:** that `node` and `claude` are on Herdr's `exec` PATH (otherwise the window says `collector failed on workstation: …`); that Grok accepts the minimal header set; that an OpenCode key needs no `Usage: Read` scope (a 403 shows its reason).
- `herdr-app check` does not run async work or timers: those are confirmed only in the running window.
- The remote path (the window on another machine) assumes `OWNER`'s app home is `~/.config/herdr-app`; it was not exercised.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/usage` passes.
- The Usage button shows in the 80px slot; clicking it opens the window under the button (lit while open; a second click closes it, as does Esc after a click inside the window; a click elsewhere does not), with four tabs, the plan under the name, limits with resets, seven day rows (today bold) and model rows.
- A first `collect.mjs --open` on `desktop` writes four records; each tab shows `as of …` readings that match the providers' own pages.
- Two quick Refresh clicks make one attempt per provider (check `attempt.startedAt`).
- `ctrl-shift-u` opens the window and a second press closes it; `ctrl-shift-?` lists it as "mod open usage".
- Nothing runs while the window is closed. Leaving it open for over 10 minutes shows `stale · …`, not `as of`; an expired login shows `sign-in needed`, not a number.
