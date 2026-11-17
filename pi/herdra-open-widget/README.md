# Herdra's list widget

A small Pi extension, kept in this repo, that draws Herdra's open items above the
editor in Herdra's own Pi pane (herdra task-120). It reads the record that
already exists and writes nothing.

```
── herdra · 2 need you · 3 in progress · 1 next · 3 pending ────────────────────────────────────
herdra    ▸ Sideshow window: say whether the sample session is right               check 6h32m ↗
homelab-server  ▸ start the scrub runner (sudo)                                                 decide
             A. dry run on the sample first, then the real sweep
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
.pi       ● making the inbox log small
herdra    ● widgets track: build the list widget
algorant  ● the idle-marked owner                                                       idle 22m
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
next      ○ task-121: the next thing Herdra could start
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
pending   ◌ +3 more pending

<the editor>
```

## One source

Every line comes from `bin/herdra-open list --json`, which is the same record the
footer and the Herdra window read, and which already carries
`bin/herdra-silent`'s idle mark. One `hc ls --json` names the project that holds
an In progress item. Nothing is written; `whois` is not needed because the tag
column shows projects, not names.

Colour is an accent, never the whole line (herdra task-131, the middle version).
Blue (`mdLink`) is the tag of every row, so a row reads *who has it*, then *what it
is*; green (`accent`) is only the `●` of work in progress; sand (`warning`) has two
jobs, the `▸` on a row that waits on Algorant and an age that has gone stale; red
(`error`) is the idle mark; the words are drawn in `text`, a held row stays
`muted`, and the rule is `dim`. Nothing else draws a colour.

- Sections in the order they mean: **you** needs Algorant (its sand `▸`), **in
  progress** (the green `●`), **next** (an `○` in the text colour), **pending**
  (grey, `◌`). One dim dashed rule (`╌`, drawn in the theme's `dim` across the
  pane's full width) sits above the first row of every section after the first,
  so the sections read as groups; a section with nothing in it draws nothing and
  earns no rule, so the list never opens with one under the header.
- The tag column is who has it, at most 10 characters: the project for every row,
  his own included — `.pi`, `homelab-server`, `herdra` — or the section words `next` and
  `pending`, which keep their row's colour. A row that waits on Algorant is tagged
  with its item's own `project`, exactly like the other rows: its `on` is the person
  waiting, and the sand `▸` is the only thing that says it is his. An item held by a
  Worker or a manus of Herdra resolves to Herdra's space, so it reads `herdra`,
  never its track. A row that repeats its tag loses it: `homelab-server: making its
  board true` and `cleanup (.pi)` read as `making its board true` and `cleanup`,
  while the section words are left alone.
- The right side of a Needs-you row is its kind — `decide`, `approve`, `check`,
  `read` — in grey, then its age once the item is at least an hour old: grey, or
  sand past six hours. An In progress row shows only its age, under the same rule,
  or the idle mark in red when `herdra-open` reports one; a Needs-you row whose
  owner has answered reads `answered` instead of an age (see below). A row that just moved
  says nothing, so the column is a note and not a clock; `AGE_SHOW_S` and
  `AGE_STALE_S` in `index.ts` are the two thresholds. The age is `dur` of the
  item's `updated ?? at` — its last real change, not its creation (task-139) — so
  a row Herdra reworded a minute ago says nothing however old the work is, and the
  age does not tick between reads.
- A Needs-you row carries one dim line under it (task-139): Herdra's `rec` when
  the item has one, else the first line of his `ask`, so a row he must decide is
  never only a terse title with its choices somewhere in the chat. An answered row
  drops it (the answer is already on the row). At most `DETAIL_MAX` (2) rows get
  one, and only while the list still fits `LINES_MAX`: a row is never dropped to
  make room for a detail line.
- A narrow pane gives way in that same order: the kind goes first, then the age
  (or the idle mark), and only the subject is shortened; below the width of the tag
  column, the gap and the glyph, the lead itself is truncated. A row, like the
  header, is one line at any width — pi-tui throws on an over-wide line instead of
  wrapping it, which is why `fitSegments` in `render.ts` draws the header and the
  lead (`herdra task-126`).
- A row whose item has a post link (`links[]` with kind `post`) ends with `↗` in
  the theme's link colour (verdigris' `secondary`), underlined, wrapped in an OSC
  8 hyperlink to it, so the terminal opens the post. Only an `http`/`https`
  target without control characters is drawn: anything else gets no marker. The
  escapes are appended after the padding: they never enter the width maths, and
  each row, and each rule, is exactly the pane's width.
- Limits: at most 10 item rows; Up next at most 3; Pending beyond 2 folds into
  one `N pending · alt+o to show` row; You and In progress each get at most 4 rows
  and say `+N more` for the rest; the header counts are always the whole truth,
  and the tag of a folded Pending row is the header's own word.
- `alt+o` or `/pending` opens or folds Pending (task-150). Open, it lists every
  item and is left out of the 10-row limit, so it never takes In progress's room.
  The switch lives in memory only: a toggle redraws from the last read (no read,
  no `hc` call), and every reload starts folded.
- One blank line sits between the list and the editor. Pi draws the blank line
  above the list itself.

An item on an owner that carries a `thread` link is shown in **you**, kind Read,
when its thread got the owner's reply after the item's last change: `herdra-open`
derives that from the inbox log at read time and the widget only shows it (its
`answer` is the reply's headline, hence the `answered` mark). Nothing is written,
so the row returns to In progress by itself if the item moves, and a read with no
thread-linked item — or one whose inbox log is not newer than the record —
forks nothing extra and never holds the list back waiting for it. A derived ask
row is not delivered: it still needs `herdra-open deliver` and `seen`, so
`herdra-check` keeps naming it through `answer-unsurfaced` until then.

## Where it loads

`../.pi/settings.json` in this repo lists it:

```json
{ "extensions": ["../pi/herdra-open-widget/index.ts"] }
```

Pi resolves a relative path in project settings against the project's `.pi`
directory, so that entry names this folder from a clone; the file is committed so
every checkout of this repo has it. Pi reads project settings only for a trusted
project: Algorant's `defaultProjectTrust` is `always`, so no trust question
appears when it is added or when Herdra reloads. On a checkout with the default
`ask`, Pi asks once, the first time the project is opened.

Loading is not drawing. A guard at `session_start` reads the terminal's own `hc ls`
entry and draws only when it is **the Ceph of the herdra space**: agent `pi`, in
the `herdra` space's `main` tab, with no parent. That is the same rule the Herdra
mod uses for "a Ceph" (`herdr-app/herdra/mods/herdra/data.js`). So:

| Pi | draws? |
|---|---|
| Herdra, in the `herdra` space's `main` tab | yes |
| a Worker in that tab (it has a parent) | no |
| a manus of Herdra (its own tab) | no |
| any other project's Ceph | no |

If `hc ls` cannot be read the extension says so once and draws nothing.

## When it reads

Event-driven; there is no interval and no poller.

- Pi's `turn_start`, `turn_end` and `agent_settled`, and the first `session_start`.
- A change to `open.jsonl` (`fs.watch` on its directory, filtered to that file,
  debounced 250 ms).
- At most one one-shot timer: an In progress item whose owner is already idle
  cannot carry the idle mark until the owner has been idle for `SILENT_S`
  (15 minutes, `bin/lib/silent.ts`), and that moment is known from the owner's
  status start and the item's last change. One `hc get` per such owner gives the
  start time; the single timer is set for the earliest moment and never re-arms
  itself, so an idle Herdra wakes once, not on a schedule.

Each read runs `bin/herdra-open list --json` and one `hc ls --json`; the mark a
read shows is as fresh as that read, and ages do not tick between reads.

The one read a turn adds is the **turn-end check** at `agent_before_settle`.
Herdra keeps the words Algorant typed since the last settle and the Needs-you
rows that were on screen when the run began. At that last boundary, if his words
touch one of those rows and the row is still under Needs you and unchanged in the
record, the model is handed the record calls that move each one — one line per
row, naming `answer` (only when the item carries its inbox thread), `update`,
`close` and `--parked` — with the instruction to move each in that turn and to
close or park a row he dismissed, deferred or answered rather than leave it. It is
a proposal, never an action: nothing is closed on a guess. Once: after that
continuation, or any check at all, nothing fires again until he types again. It
costs nothing when there is nothing to check — no read, no timer, no write when he
typed nothing, no Needs-you row was on screen, or the check already ran this run.

Touching is a word the row is *about* (`bin/lib/match.ts`, the one authority: it
is also what `bin/herdra-open` reads when a new row looks like one already open).
Filler never ties a row, and neither does the list's own vocabulary: `list`,
`bar`, `sideshow`, `approve`, `proposal`, `check`, `review`, `herdra`, `herdr`,
`window`, `widget`, `board`, `look`, `fix`, `merge`, `/reload`, a restart — he
writes those whenever he talks about Herdra, and they fired on rows he never
meant (herdra task-128). A row's own project is not a token either: naming `.pi`
does not say which of its rows he meant, so the project's words are dropped from
the row's tokens. What is left ties a row when his words share

- one id (a word with a digit, hyphen, dot or colon in it — `task-124`, `.pi`,
  `o372`) that no other row on screen carries, or
- the row's **subject**, the first distinctive word of its line (`dotfiles` on the
  dotfiles-switch row, `pages` on the app-pages row), or
- two of its words when at least one is carried by no other row on screen.

Two shared words alone are not enough (task-135): the 2026-11-12 reply about
shelf-pin folders, a review page and status lists shared `links` with the
dotfiles-switch row and used to flag it on every turn. A row's words are its own
line, a linked Task id, a post's last path segment and an agent's name; his words
match whole, an id also inside a longer word.

It also owns its slot: Pi keeps above-editor widgets in the order they were set,
and re-setting the same key moves it last, nearest the editor. The widget
re-mounts on every read, so it stays below a pi-ui section that appeared after it,
and its one trailing blank line is the only gap before the editor.

## Checking it

A scratch Pi in a throwaway hc core, never Algorant's pane:

```sh
export HC_TEST_ROOT=/tmp/herdra-open-widget
mkdir -p $HC_TEST_ROOT/{run,state,config,home/.pi/agent/themes}
cp ~/.pi/agent/themes/verdigris.json $HC_TEST_ROOT/home/.pi/agent/themes/
printf '{"theme":"verdigris","defaultProjectTrust":"always","quietStartup":true}' \
  >$HC_TEST_ROOT/home/.pi/agent/settings.json
XDG_STATE_HOME=$HC_TEST_ROOT/state bin/herdra-open add --project homelab-server \
  --on algorant --waiting "a go" --closes "he goes" --ask "do you want the sample?" \
  "a sample item"
~/.pi/agent/scripts/hc-test run --bg --rm --no-notify --no-parent --name herdra \
  --label 'where=herdra / main' --cwd "$PWD" -- pi -e "$PWD/pi/herdra-open-widget/index.ts"
~/.pi/agent/scripts/hc-test read herdra --lines 40
```

The same command with `--label 'where=herdra / widgets'`, with `--parent <t>`, or
with another project's space label shows no widget. Stop the scratch core with
`~/.pi/agent/scripts/hc-test server stop` (it is scoped to `HC_TEST_ROOT`).
