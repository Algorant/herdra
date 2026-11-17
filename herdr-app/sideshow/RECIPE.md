# Sideshow

A floating window on the right of Herdr that shows one [Sideshow](https://www.npmjs.com/package/sideshow) session as a running thread, drawn natively: its posts newest first, each with its retained rounds (v1…vN) and its comments, every part on its own card (look C, picked by Algorant in task-46-16). A session is one topic; a picker switches to another, and a finished topic can be archived. `ctrl-shift-s` opens and closes it (task-114 replaced task-50's all-sessions feed; mockup: `research/task-114-mock/`, plan: `research/task-114.md`).

## What you see

A card floating over the right side of the terminals, sitting on the pane cards' own lines:
- its top edge on the cards' top (tab bar height + the work area's padding, 42 + 8);
- its bottom on the cards' bottom (above the status bar, 28 + 8);
- its right edge 8px in from the window edge, like the cards;
- 45% of the window wide (but leaving at least 240px of terminal).

These come from the shown layout (`layout()`: `tabs`, `status` and `sidebar` sizes, the `work-body` padding), so a hidden status bar or another tab-bar height still lines up. The card looks like the shipped Files panel and the pane cards: `frame: "none"` (no Herdr dialog frame or shadow), theme `background`, 1px `border`, radius 10. A drag moves it, and Herdr remembers that spot (`key: "sideshow"`). It reopens after a restart (`keep: true`). Theme colors throughout, 13px UI text.

1. **Header**, 42px, 1px `border` underneath:
   - a 7px status dot: `accent` with a session, `dim` without;
   - "Sideshow" in 11px `dim`;
   - the **session button**: the project chip, the session's title in 12.5px medium, truncated, and a `▾`; a `selected` fill while the picker is open. A click opens it;
   - right-aligned 11.5px text actions in `muted` that turn `foreground` on a `hover` fill: **Browser ↗** (the session's page, opened at its newest post), **Archive**, **✕**.
2. **Bar**, 34px on `chrome`, 1px `border` underneath: on the left `dim` 11.5px numbers — "3 posts · 2 updated · 2 rounds · 2 comments"; on the right a `done` dot and "live", or **Newest ↑** in `accent` (with "held" beside it) when the window stopped following.
3. **Thread**, the rest, scrolling, padding 14, 14px between posts. Newest post first, then older ones down to the first; the first line says where the view stands, at the top: "following the newest" (`dim`), or "opened at a post · 4 newer posts" with **Back to newest** in `accent` when the window was opened from a post's link.
   - A post opens with the project chip, an "updated" tag for a post with rounds, then its title in 16px semibold, then 11px `dim`: "<age> · v<round> · <n> parts", plus " · <k> in the browser" when there are html or mermaid parts.
   - Every part is a **card**: `chrome` fill, 1px `border`, radius 8.
   - **markdown**: on a soft card, padding 14×12, `TextView.markdown`, selectable. Each `![alt](…)` is split out and drawn as a framed image between the text parts.
   - **image**: framed. The asset sits in the card with a 3px inset, radius 6, scaled to the width. Its caption (or its alt text) goes under it in 11.5px `muted`, behind a 1px `border` line.
   - **terminal, code, diff, json**: a 28px caption strip, then a read-only code editor on `background` (no line numbers, soft wrap, settings font 12px, ANSI syntax colors, 18px per line, at most 480px).
     - The strip shows the surface title. Without one it shows Terminal, the language, the diff's filenames, or JSON.
     - Then "<n> lines" and **Copy** (copies the text, then shows "Copied").
     - A terminal surface keeps the colours it was published with (task-119): its SGR foreground colours (`30`–`37`, `90`–`97`, `38;5;n`, `38;2;r;g;b`), bold and dim are drawn as text runs in the same code font, one row per line, 18px apart, on the same `background` and in the same card. The 16 basic colours come from the theme (`ansi0`–`ansi15`), the 256-colour cube and greys and truecolor as the hex they name; a reset ends them. Every other escape (cursor moves, backgrounds, underlines) is dropped, as before. Only the foreground is drawn: a coloured background is not.
     - Plain text with no escapes still draws in the editor, unchanged, and so does a surface whose only escapes carry no colour, bold or dim.
     - Copy copies the plain text, never the escapes.
   - **mermaid**: the same code card with the diagram source, plus **Diagram ↗** in `accent` to see it drawn in the browser.
   - **html**: the strip reads "HTML · drawn in the browser" with **Open ↗** in `accent`, over a text preview of the page's words (tags stripped, 320 characters at most) in 12px `muted`. The whole card opens `/p/<id>` in the browser.
   - **trace**: the strip with "<n> steps", then a timeline: a dot per step (the last in `accent`), its kind as a small `raised` chip, label, and detail in `muted`.
   - **Anything else**: the strip "<kind> · drawn in the browser" with **Open ↗**.
4. **Rounds**, under a post that has more than one: "rounds" then a 11px chip per retained version, `selected` with an `input` border for the one shown, plus "· from 30m ago" when an older one is shown. Up to 6 chips: the first, "…", then the newest five. A click on a chip shows that version in place (**Back to latest** in `accent` sits by the post's title while one is shown).
5. **Comments**, under the post they belong to, behind a 2px `raised` rail: oldest first, each with its author (11px, `accent` for you, `muted` for the agent), a bordered chip naming the surface a pinned comment sits on, its age in `dim`, and its text in 12px. A comment with no post (a session note) sits at the top of the thread.
6. **Session picker** (from the session button): a `popover` card with `shadow_lg`, 8px in from the sides, just under the header, at most 360px and scrolling. Rows are 30px, newest activity first: number in `dim`, project chip, title (`foreground`, medium and a `selected` fill for the shown one, else `muted`), a 6px `accent` dot when the session changed since it was last looked at, then "<posts> · <age>". Past 12 rows: "N more sessions · show all". Then "▸ archived · N", which opens the archived sessions (title in `dim` with **Restore**), and a last line "localhost:8228 · 106 sessions". A click on a row switches; a click on the thread or Esc closes it.
7. **Nothing to show**: "Loading…" until the first poll lands, "No posts in this session yet" in a card for an empty session, "No sessions with posts" when the server has none.
8. **Errors** (Sideshow down, a 404) show on a card in `blocked`, above the thread; the thread keeps its last good content.

## How it behaves

- **One session, one thread.**
  - The thread is one session's posts in the order they were published (oldest first), drawn newest first so new work appears at the top. An edited post stays in its place and gains "updated" plus its rounds; it does not jump to the end.
  - Comments come from the same session and are drawn under their post, so the conversation stays with the work.
  - Sessions are labelled by project, from their `cwd`: a worktree maps to its repo (`…/worktrees/<repo>/<branch>`, under `~/Projects/worktrees` or `~/.herdr/worktrees`), else the folder under `~/Projects`, else the home dot-folder (`~/.pi`), else the last path segment. The chip's colour is one of the theme's ANSI colours by a hash of the name. Sessions carry no machine, so every session is labelled by project only.
- **Choosing.**
  - At open it shows the session with the newest activity that has posts and is not archived.
  - **Opened from a link it shows that post.** Herdra's **Post ↗** and **Open ↗** rows hand the window `props().url`, a Sideshow address (`…/p/<post>` or `…/session/<id>`, e.g. `http://workstation.<tailnet>.ts.net:8228/p/8nRAN-31yl8`). The address's post is asked of the server (`GET /api/posts/:id`), so it reads where the post is now, and its session is shown with that post at the top of the thread; the newer ones are out of the way and counted, and **Back to newest** brings the whole thread back. A session's address just shows that session. The address is read once, at open: a session picked by hand or a hold afterwards is the person's. An address that does not read (a 404) says so on the error card and the window carries on with the newest.
  - Picking one by hand keeps it: another project publishing never yanks the view. Its own picker row carries a dot until you look at it.
  - Archiving the shown session moves to the next newest with posts.
- **Live.**
  - While the window is open, one 5 s in-process timer fetches `GET /api/sessions` (a few kB; 106 sessions on this server).
  - The shown session's posts and comments are fetched only when its `lastActiveAt` differs from what they were fetched at — so once per poll while that session is being written to, otherwise not at all. A failed poll keeps the thread and shows the error.
  - `/api/posts/:id` is fetched with them, once per post that has rounds or an html part.
  - Following the newest, a new post, a new round or a new comment resets the thread's scroll to the top within about 5 s; **↑**, **Home** or **k** holds the view where it is, and **Newest ↑**, **End** or **j** goes back to following.
- **Rounds.** A chip switches the post's parts (and its title) to that retained version, rebuilt from `history` in `GET /api/posts/:id`; Sideshow keeps the last 20. A new version returns the post to its latest.
- **Archive.** **Archive** appends the session id to `data/sideshow/archived` under the app home (one id per line, next to the origin file), hides it from the picker and the auto-pick, and leaves Sideshow itself alone, so an agent that resumes the topic still finds its session. The picker's archived fold lists them with **Restore**. No sync across machines: each window has its own file.
- **Origin.** The server is read once at open from `~/.config/herdr-app/data/sideshow/origin` (one line, e.g. `http://workstation.<tailnet>.ts.net:8228`). Without the file it is `http://localhost:8228`, a default, not a fallback: a configured origin that fails shows the error card. On laptop the file names workstation's server. The origin serves the API, asset downloads and **Browser ↗**.
- **Images.**
  - `image()` only loads files under the app home, and Herdr gives GPUI no HTTP client. So each asset is downloaded once with `curl` to `~/.config/herdr-app/data/sideshow/assets/<id>` (`.part`, then `mv`), and `identify` reads its size.
  - Sideshow asset ids are content hashes, so a file is never rewritten. That sidesteps the image-memory growth of herdr-app#22.
  - Markdown images by URL are cached under an FNV hash of the URL.
- **Browser.** "Open ↗", "Diagram ↗" and **Browser ↗** use `cx.open_url` (the system browser) for `/p/<post>` and `/session/<id>`. **Browser ↗** opens the shown session at its newest post, `/session/<id>/p/<newest post>`, so a long thread lands at the end instead of at the top; a session with no posts opens `/session/<id>` (task-138). The terminal's own links are the app's to hand to the browser, so a link in a reply still leaves Herdr; **Post ↗** in the Herdra window is what stays in.
- **Toggle.**
  - `ctrl-shift-s` runs `mod.open:sideshow`. `mod.json` makes that a 2×2 px, frameless popup of the same mod.
  - With `props().overlay` set and no `props().window`, the copy reads shared `"sideshow.window"`. If it holds an id, it closes that window; otherwise it opens `{mod:"sideshow", props:{window:true}, kind:"window", frame:"none", key:"sideshow", keep:true, width, height, at}`, all in px from `window.viewport_size()` and the layout. Then it closes itself.
  - The window writes its overlay id to `"sideshow.window"` on every poll and clears it in `close()`.
- No sounds, toasts or redraw timers; the one 5 s timer only notifies when something changed. Nothing runs while the window is closed.

## Built from

- **Layout:** none; it works on Herdr's shipped `main`. `mods/sideshow/mod.json`: `{"place":"none","title":"Sideshow","overlay":{"kind":"popup","frame":"none","width":2,"height":2}}`.
- **`mods/sideshow/main.js`**, one `View` with two roles (toggle popup, window):
  - `herdr`: `theme()`, `settings()`, `props()` (the window role reads `props().url`, the address it was opened on), `appHome()`, `shared`/`setShared` (`"sideshow.window"`), `openOverlay`, `closeOverlay`, `exec` (`curl`, `mv`, `identify`), `readTextFile`/`writeTextFile` (the archive file, the button icon).
  - `gpui-kit`: `View`, `div`, `image`, global `window.viewport_size()` (the spot), `cx.open_url`, `cx.write_to_clipboard` (Copy), `cx.focus_handle` + `track_focus`/`on_key_down` (hold and follow), `absolute()` (the picker).
  - `herdr` `layout()` and `settings().zoom` for the spot's lines.
  - `gpui-base`: `v_flex`, `h_flex`, `TextView.markdown`, `EditorState` + `Editor`.
  - `fs/promises`: `mkdir`, `exists`, `readFile` (the origin file). Global `fetch` to the Sideshow API.
  - Root: `on_size_change` for the width (image sizes).
- **Sideshow API (GET only):** `/api/sessions` (id, title, cwd, lastActiveAt, postCount), `/api/sessions/:id/posts` (full posts with surfaces, newest activity per session), `/api/posts/:id` (one post with `history` — its retained rounds — and html bodies), `/api/comments?session=<id>` (`{comments, lastSeq}`: id, seq, postId, author, text, createdAt, anchor), `/a/:assetId`. Origin: the origin file, default `http://localhost:8228`.
- **`keys.json`**: `"global": { "ctrl-shift-s": "mod.open:sideshow" }` (snippet in `keys.json` here). Herdr's Help overlay (`ctrl-shift-?`) lists it as "mod open sideshow".
- **Programs:** `curl`, `identify` (ImageMagick).
- **`data/sideshow/origin`** (optional, local machine state, not in this repo): the server's URL.
- **`data/sideshow/archived`** (local machine state, not in this repo): one archived session id per line.

## Watch out

- **Reaches the network, runs programs and writes files.** GETs to the local Sideshow, `curl` for assets; writes only under `~/.config/herdr-app/data/sideshow/` — the asset cache, and the archive file on a click.
- **Sideshow has no archive.** A session is `id, agent, title, cwd, createdAt, lastActiveAt, agentSeq` and nothing else: `PATCH /api/sessions/:id` only renames, and `DELETE` destroys its posts, comments, trace and assets. Hence the local hide list; do not "fix" it by renaming or deleting.
- **A comment bumps `lastActiveAt`**, so comments arrive with the posts on the same fetch. A session that only gains comments still refreshes.
- `GET /api/sessions/:id/posts` omits html bodies (only `id`, `index`, `kind`) and, on 0.14, has no `versionCount`; the window reads `/api/posts/:id` for html bodies and for `history`.
- **`EditorState.new` throws inside `render`.** Every part of every post in the thread gets its editor state in `prepare()`, called when the session's posts load or a round is switched, and all are released there and in `close()`. That is one state per text part of the whole session, where task-50 had one post's worth: a 15-post session with 30 text parts is still small (nothing but the shown parts is measured).
- **`width`/`height` up to 1 are shares of the window:** the toggle popup must be `2`×`2` px, not `1`×`1` (that's the whole window).
- **The palette can't list it.** The palette is Herdr's own frame mod and hides `mod.open`, so the key is the way in (upstream ask drafted in `research/task-46-14-upstream-issue.md`).
- **Hot reload:** the old copy's `close()` runs after the new copy's `init` and clears `"sideshow.window"`. Re-asserting the id on every poll fixes it; without that, the next `ctrl-shift-s` opens a second window instead of closing it.
- After a crash, `"sideshow.window"` can hold a dead id: the first `ctrl-shift-s` then only clears it, and the second opens.
- A press the window doesn't stop drags it: list rows, buttons, the picker and the thread body stop `mouse_down`, so only the header drags.
- **An `absolute()` element with `overflow_y_scrollbar()` loses its position** (the scrollbar wraps it): the picker puts the spot on a plain outer `div` and scrolls a `v_flex` inside it.
- **A scroll view keeps its offset per id:** the thread's id carries the session, the post it was opened at, and the newest post's id/version (or, held, the id it was held at), so following starts at the top and holding keeps its place.
- **Newest first, not oldest first.** A plain GPUI scroll area starts at the top and cannot be moved from code, and the only programmatic scroll (`list()` + `VirtualListScrollHandle.scroll_to_bottom()`) forbids handlers in its rows — which every post's parts need. So the thread is drawn newest first, and a post comes into view by being at the top: opened from a link, the thread starts at that post and the newer ones are left out and counted.
- **Archive writes compare-and-swap:** `writeTextFile` takes the text it last read and refuses a stale snapshot. The file is read once at open; a change made by another process while the window is open makes that click's write fail (logged), not silently overwrite.
- Sessions with no posts are skipped when auto-picking: an agent that has created a session but not published yet never takes the window.
- `cx.open_url` goes to `xdg-open` on Herdr's PATH. A future link shim that routes Sideshow URLs into this mod must not route the mod's own "Open in browser".
- Markdown images in `TextView` never draw (herdr-app#148): hence the split at `![…](…)`. Inline HTML `<img>` in markdown isn't handled.
- Sessions carry no machine name, so sessions from another machine's server are labelled by project only.
- **The spot is computed when the window opens, and a remembered one is not reused off-view.** The window opens at the place `readerWindow()` computes, or where it was dragged to. Herdr keeps that place in `windows.json`: `places["sideshow-work"]` is the drag spot (`[x, y]`) and `kept[<layout>]["sideshow-work"]` is the spec a restart reopens it with. Those are in the px of the app window they were made in, so after the app window has shrunk the window is mostly outside it (task-132). At open the window reads `windows.json`, and when the place the app opened it at is not all inside the app window it closes itself and opens again at the fit — Herdr's own `keep` then remembers the fit, and a drag spot is dropped by the close. A place that fits is left alone, a dragged spot is tested with the size the window has, and one place is re-placed at most once per run so a stale place cannot make the window reopen for ever.
- Resizing the Herdr window while the window is open still doesn't move it: close and reopen it to refit. A dragged spot is Herdr's and wins over the computed one while it fits.
- `width`/`height` in the spec are px from `viewport_size()`; layout px are multiplied by `settings().zoom`. Only zoom 1 was checked.
- **`props().url` is read once, when the window starts,** because Herdr replaces a window opened on the same key (`sideshow-work`, which Herdra's rows use too): a new address is a new copy. Do not move it into `render`, where it would re-place the view on every frame.
- **Shots float over the person's terminals.** Develop with `check --print-spec` on a fixture copy (fill `sessions/posts/comments/details`, call `prepare(null)`): variants with `FIXTURE.jump` (picker), `FIXTURE.old` (archived), `FIXTURE.rounds` (an older round) and `FIXTURE.held` cover every state. Open the real window only for a short open, shoot, close batch. **The check runs no `await`:** a spawned task's continuations never run before the spec is printed, so an address's `GET /api/posts/:id` cannot resolve there — seed the post's session instead, as task-130's fixture does.
- **A coloured terminal surface is drawn as text runs, not in the editor**, so it has no text selection (**Copy** still copies the whole surface) and its long lines scroll sideways instead of soft-wrapping, which is what a terminal's columns want. Its spaces are drawn non-breaking and its tabs as spaces to the next 8-column stop, so indentation and alignment survive a layout that would otherwise collapse them; the runs carry the display text, never the copied one.
- **`windows.json` is Herdr's own file and the mod only reads it** (once per window open, to see whether the place it opened at fits). It never writes it: the fit reaches the file through Herdr's own `keep` when the window reopens. `places[key]` is `[x, y]` and `kept[layout][key]` is the overlay spec, as Herdr 0.1.15 writes them; a different shape reads as "nothing remembered", and the window then simply stays where Herdr put it.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/sideshow` passes.
- `ctrl-shift-s` opens the window on the right: all four borders visible, the top on the pane cards' top line, the bottom on their bottom line above the status bar, the right edge 8px in, at 45% of the window's width. Pressing it again closes it, and the next open is at the spot it was dragged to. It's back after an app restart if it was open.
- The window shows the most recently active session's thread, newest post first, with the bar's counts and "live".
- A Herdra row's **Post ↗** opens the window on that post's session, that post at the top of the thread, "opened at a post · N newer posts" above it and **Back to newest** giving the whole thread; an **Open ↗** on a session's address opens that session.
- A post published in that session appears at the top within about 5 seconds without reopening; a comment appears under its post; editing a post shows "updated" and a new round chip.
- Clicking v2 of a post shows that round with "v2 of 3", its title, and **Back to latest**; clicking **Back to latest** returns to the newest.
- The session button lists the sessions newest activity first, with project chips, counts and ages, a dot on one that changed; a click switches the thread, and **Browser ↗** opens the shown session at its newest post.
- **Archive** hides the shown session, moves to the next one, and the picker's archived fold restores it.
- ↑ holds (bar reads "held · Newest ↑"), End follows again.
- With the origin file naming another server (laptop reading workstation's), the thread, images and **Browser ↗** use that server.
- A terminal surface published with colours shows them in its card (a `38;2;r;g;b` or `38;5;n` colour, bold, dim), and one with no escapes looks exactly as it did.
- A window whose remembered place is outside the app window (a restart after the app window shrank) opens fully inside it, not off-view.
- `ctrl-shift-?` lists `ctrl-shift-s` as "mod open sideshow".
