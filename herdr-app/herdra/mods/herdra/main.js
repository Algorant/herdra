// Herdra in Herdr: Algorant's tracker (task-57), in a floating right-hand window fitted like the
// Sideshow window: Needs you, In progress, Up next and Done from herdra-open (the same list Herdra's
// reply footer prints), a fleet strip, an "On boards, not raised" bar, and a detail view per item.
// The window draws from the shared snapshot (data.js), which the button keeps current as its one reader:
// the list on change, the boards while this window is open. Nothing polls with the window: it opens
// with data on its first frame and asks for one read. Three roles, like the sideshow mod:
//   props.button   the "Herdra · N" button in main-sideshow's tab row (N = Needs you)
//   mod.open       a tiny popup (mod.json) that toggles the window and closes itself
//   props.window   the window
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { theme, settings, layout, props, panes, shared, setShared, openOverlay, closeOverlay, run, appHome, home, readTextFile, writeTextFile, watchFolder } from "herdr";

// The app draws images only from real files under its home, and mods/herdra links into the Herdra
// repo, so the button copies its icon into data/herdra/ and draws that copy.
async function installIcon() {
  const src = await readTextFile(`${appHome()}/mods/herdra/herdra.svg`);
  if (src === null) throw new Error("mods/herdra/herdra.svg is missing");
  const path = `${appHome()}/data/herdra/herdra.svg`, cur = await readTextFile(path);
  if (cur !== src) await writeTextFile(path, src, cur);
  return "data/herdra/herdra.svg";
}
import { snapshot, refreshFast, refreshBoard, ownsList, threadText, taskText, ago, dur, norm } from "./data.js";

// Keep this geometry local to the mod: Herdr resolves imports only inside the mod folder.
// `half` is "left" or "right" for the review pair (task-161): that half of the work area, the pane's
// whole height, always computed with the Spaces sidebar's width even when it is hidden, so opening or
// closing the sidebar never covers either half. No `half` is the solo reader: 90% of the work area,
// capped at maxWidth, centred.
function readerWindow(tree, viewport, zoom, maxWidth, half) {
  const find = (node, id) => {
    if (!node || typeof node !== "object") return null;
    if (node.id === id) return node;
    for (const child of node.children ?? []) {
      const match = find(child, id);
      if (match) return match;
    }
    return null;
  };
  const sidebar = find(tree, "sidebar");
  const tabs = find(tree, "tab-row") ?? find(tree, "tabs");
  const status = find(tree, "status");
  const body = find(tree, "work-body");
  if (!tabs || !status || !body) throw new Error("reader window requires tab-row/tabs, work-body, and status layout nodes");
  const px = (node) => Number(node?.size?.px ?? 0);
  const padding = body.padding ?? 0;
  const padY = Array.isArray(padding) ? Number(padding[0] ?? 0) : Number(padding);
  const padX = Array.isArray(padding) ? Number(padding[1] ?? 0) : Number(padding);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const widthPx = viewport.width / scale;
  const heightPx = viewport.height / scale;
  const left = sidebar && (!sidebar.hidden || half) ? px(sidebar) + padX : padX;
  const right = widthPx - padX;
  const top = px(tabs) + padY;
  const bottom = heightPx - px(status) - padY;
  const areaWidth = Math.max(0, right - left);
  const areaHeight = Math.max(0, bottom - top);
  const width = half ? Math.round(Math.max(0, (areaWidth - PAIR_GAP) / 2)) : Math.round(Math.min(areaWidth * 0.9, maxWidth));
  const height = half ? Math.round(areaHeight) : Math.round(areaHeight * 0.9);
  const x = half === "right" ? right - width : half ? left : left + (areaWidth - width) / 2;
  const y = half ? top : top + (areaHeight - height) / 2;
  // The overlay parser zooms width/height, but render_window consumes at as pixels directly.
  return { width, height, at: { x: Math.round(x * scale), y: Math.round(y * scale) } };
}

const POLL_MS = 5000;        // the tick: a refresh request, the window, a machine that came back
const TANDEM_MS = 60000;     // the boards, while the window is open
const LIST_MS = 60000;       // the list, on a machine that does not hold it
const WATCH_MS = 2000;       // the soonest a second watch-triggered list read follows a first
const MAX_WIDTH = 960;
const KEY = "herdra.window";        // shared: the open window's overlay id
const SOLO_KEY = "herdra-work";     // the solo window's overlay key: windows.json remembers its place
const PAIR_KEY = "herdra-pair";     // the pair's left half (task-161), remembered apart from solo
const PAIR_GAP = 8;                 // between the pair's two halves, as the pane cards' gap
const OTHER = "sideshow.window";    // shared: the Sideshow window's overlay id, paired or not
const WANT = "herdra.wantRefresh";  // shared: a copy asking the button for one read (set with Date.now())
const STATE = `${home()}/.local/state/herdra`;
const LOG = `${STATE}/open.jsonl`;

function readerSize() {
  return readerWindow(layout(), window.viewport_size(), Number(settings().zoom ?? 1), MAX_WIDTH);
}

// The spot a window opens at: the solo reader, or one half of the pair.
const spot = (half) => readerWindow(layout(), window.viewport_size(), Number(settings().zoom ?? 1), MAX_WIDTH, half);

// Open synchronously: a window opened from an async task after an await never shows.
function toggle(done) {
  const open = shared(KEY);
  if (open) { closeOverlay(open); setShared(KEY, null); done?.(); return; }
  const { width, height, at } = readerSize();
  openOverlay({ mod: "herdra", props: { window: true, openAt: Date.now() }, kind: "window", frame: "none", key: SOLO_KEY, keep: true, width, height, at });
  done?.();
}

const stop = (_e, cx) => cx.stop_propagation();

// One fast read; a machine that came back (the edge refreshFast computes) marks the boards due.
async function fastRead(view) {
  if ((await refreshFast()).length) view.boardDue = true;
}

// The button is the one reader, and its tick does no subprocess work of its own: it runs one fast read
// when a copy asked for it (the window, on open) and the board read only while the window is open, or
// for a machine that came back. One run of each at a time, so a slow board never holds up the rest.
function keepCurrent(view, cx) {
  view.busy = {};
  view.win = null;        // the window id at the last board read
  view.lastBoard = 0;     // when the boards were last read
  view.boardDue = false;  // a machine came back: the next board read, once the window is open
  const run1 = (name, fn) => {
    if (view.busy[name]) return;
    view.busy[name] = true;
    cx.spawn(async (cx) => {
      try { await fn(); if (view.error) { view.error = null; cx.notify(); } }
      catch (e) { const m = String(e?.message ?? e); if (view.error !== m) { view.error = m; cx.notify(); } }
      finally { view.busy[name] = false; }
    });
  };
  cx.timer.every(POLL_MS, (cx) => {
    const now = Date.now(), win = shared(KEY);
    if (shared(WANT) !== null) { setShared(WANT, null); view.boardDue = true; run1("fast", () => fastRead(view)); }
    if (!win) { view.win = null; return; }   // closed: no board read, and the window id is forgotten
    const opened = view.win !== win;         // opened since the last tick
    if (!view.boardDue && !opened && now - view.lastBoard < TANDEM_MS) return;
    const gated = view.boardDue || opened;   // herdra-online's machine-gated list comes with these
    view.boardDue = false;
    view.win = win;
    view.lastBoard = now;
    run1("fast", () => fastRead(view));   // statuses and the fleet strip stay current while it is open
    run1("board", () => refreshBoard(gated));
  });
}

// The list. Where this machine holds it, read it when open.jsonl or its folder changes; elsewhere read
// it through hc once a minute. One pending flag and a read on the WATCH_MS tick make a burst one read at
// most every 2s; only open.jsonl and the folder count. This cannot feed itself: `herdra-open list` only
// reads open.jsonl and hc (its silent mark, bin/herdra-silent) and never writes open.jsonl, and any other
// path in the batch is ignored.
function keepList(view, cx) {
  let failed = null, pending = false, reading = false;
  const read = async () => {
    try { await fastRead(view); failed = null; }
    catch (e) {
      const m = String(e?.message ?? e);
      if (failed !== m) { failed = m; console.log(`herdra: ${m}`); }
    }
  };
  const spawnRead = (cx) => {
    if (reading) return;
    reading = true;
    cx.spawn(async () => { await read(); reading = false; });
  };
  cx.spawn(async (cx) => {
    let owner;
    try { owner = await ownsList(); }
    catch (e) { console.log(`herdra: ${e?.message ?? e}`); return; }
    if (!owner) {
      await read();
      cx.timer.every(LIST_MS, (cx) => spawnRead(cx));
      return;
    }
    cx.timer.every(WATCH_MS, (cx) => {
      if (!pending || reading) return;
      pending = false;
      spawnRead(cx);
    });
    await read();
    try {
      for (;;) {
        const paths = await watchFolder(STATE);
        if (paths.includes(LOG) || paths.includes(STATE)) pending = true;
      }
    } catch (e) { console.log(`herdra: watching ${STATE}: ${e?.message ?? e}`); }
  });
}

const youOf = (snap) => snap.fast?.you ?? [];
const itemsOf = (fast) => [...(fast?.you ?? []), ...(fast?.progress ?? []), ...(fast?.next ?? []), ...(fast?.pending ?? []), ...(fast?.done ?? [])];
const taskOf = (item) => item.links.find((l) => l.kind === "task") ?? null;

const SECTIONS = [
  ["you", "Needs you", "only you can answer these · most urgent first", "Nothing needs you."],
  ["progress", "In progress", "what is in flight, and who has it", "Nothing is in progress."],
  ["next", "Up next", "queued · most important first", "Nothing is queued."],
  ["pending", "Pending", "waits on a time, or on a machine coming back (Tasks tagged needs-<host>)", "Nothing is pending."],
  ["done", "Done", "finished outcomes, last 24 hours", "Nothing finished in the last 24 hours."],
];

// The option Herdra recommends: `rec` starts with that option's letter ("A. …"). An option reads
// "Title — detail".
const recIndex = (item) => {
  const m = /^\s*\**([A-Z])[.:)]/.exec(item.rec ?? "");
  const i = m ? m[1].charCodeAt(0) - 65 : -1;
  return i >= 0 && i < item.options.length ? i : -1;
};
const optionOf = (s) => { const [title, ...rest] = String(s).split(" — "); return { title, detail: rest.join(" — ") }; };

// What the log says happened to an item, newest first.
function historyOf(item) {
  return [...item.history].reverse().map((h) => {
    if (h.op === "open") return { at: h.at, text: `Raised · on: ${h.on}` };
    if (h.op === "close") return { at: h.at, text: `Closed${h.note ? ` · ${h.note}` : ""}` };
    const what = h.fields.map((k) => k === "on" ? `now on: ${h.on}` : k === "parked" ? (h.parked ? "parked" : "unparked") : k);
    return { at: h.at, text: `Updated · ${what.join(", ")}` };
  });
}

export default class Herdra extends View {
  init(_props, cx) {
    if (props()?.button) {
      this.role = "button";
      this.icon = null;
      cx.spawn(async (cx) => {
        try { this.icon = await installIcon(); cx.notify(); } catch (e) { console.error(`herdra button icon: ${e?.message ?? e}`); }
      });
      keepCurrent(this, cx);
      keepList(this, cx);
      return;
    }
    if (props()?.overlay && !props().window) {
      this.role = "toggle";
      const me = props().overlay;
      toggle(() => closeOverlay(me));
      return;
    }
    this.role = "window";
    this.error = null;
    this.sel = null;     // the open item's id: its detail view replaces the list
    this.open = {};      // row or link key -> expanded
    this.loaded = {};    // link key -> { text, post? } | { loading } | { error }
    this.more = {};      // "board" -> expanded
    this.openAt = props()?.openAt;
    setShared(WANT, Date.now());   // one read for this open: the button is the reader
    // A hot reload can clear the toggle's note of this window (the old copy's close() runs last): restore it.
    const id = props()?.overlay;
    if (id && shared(KEY) !== id) setShared(KEY, id);
  }

  snap() { return snapshot(); }

  // ---- going places ----

  dismiss() { closeOverlay(props().overlay); }

  // The agent's pane if Herdr shows one (its space and tab come forward), else a peek of its terminal.
  goTo(addr) {
    if (panes().some((p) => p.terminal === addr)) run("pane.focus", { terminal: addr });
    else run("terminal.peek", { terminal: addr });
    this.dismiss();
  }

  // A post opens in the Sideshow window beside this one, which keeps its place at the pair's left half.
  openPost(url) { this.pair(url); }

  // The review pair (task-161): this window at the left half and Sideshow at the right, on `url` (with
  // none: Sideshow's newest session). The app cannot move an open window, so each side is closed and
  // reopened; a Sideshow copy already open is replaced in place.
  pair(url) {
    const other = shared(OTHER);
    if (other) closeOverlay(other);
    if (!props()?.pair) {
      closeOverlay(props().overlay);
      openOverlay({ mod: "herdra", props: { window: true, openAt: Date.now(), pair: "left" }, kind: "window", frame: "none", key: PAIR_KEY, keep: true, ...spot("left") });
    }
    openOverlay({ mod: "sideshow", props: { window: true, url, pair: "right" }, kind: "window", frame: "none", key: "sideshow-pair", keep: true, ...spot("right") });
  }

  // ⤢ Pair / ⤢ Solo: pairing puts both windows at the pair's halves; solo closes the other one and
  // reopens this one at its own remembered solo spot.
  pairToggle() {
    if (!props()?.pair) return this.pair(null);
    const other = shared(OTHER);
    if (other) closeOverlay(other);
    closeOverlay(props().overlay);
    openOverlay({ mod: "herdra", props: { window: true, openAt: Date.now() }, kind: "window", frame: "none", key: SOLO_KEY, keep: true, ...readerSize() });
  }

  select(id, cx) { this.sel = id; cx.notify(); }

  // Expands a row or link; `fn` (once, then cached) loads the markdown shown under it.
  toggle(key, fn, cx) {
    this.open[key] = !this.open[key];
    const cur = this.loaded[key];
    if (fn && this.open[key] && (!cur || cur.error)) {
      this.loaded[key] = { loading: true };
      cx.spawn(async (cx) => {
        try { const r = await fn(); this.loaded[key] = typeof r === "string" ? { text: r } : r; } catch (e) { this.loaded[key] = { error: String(e?.message ?? e) }; }
        cx.notify();
      });
    }
    cx.notify();
  }

  // ---- parts ----

  action(id, label, onClick, color) {
    const t = theme();
    return div().id(id).flex_none().px(6).py(2).rounded(5).text_size(11.5).text_color(color ?? t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click(onClick).child(label);
  }

  pill(text, color, outline) {
    const t = theme();
    return div().h(18).px(7).rounded(9).flex().flex_none().items_center().text_size(11).text_color(color)
      .when(Boolean(outline), (el) => el.border_1().border_color(t.border))
      .when(!outline, (el) => el.bg(t.raised)).child(text);
  }

  chip(name) {
    const t = theme(), colors = [t.ansi2, t.ansi3, t.ansi4, t.ansi5, t.ansi6, t.ansi1, t.ansi10, t.ansi12, t.ansi13, t.ansi14];
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return colors[h % colors.length];
  }

  chipOf(project, margin) {
    const t = theme(), letter = String(project ?? "?").replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "?";
    return div().when(margin !== false, (el) => el.mt(1)).size(20).flex_none().rounded(4).flex().items_center().justify_center()
      .bg(this.chip(project ?? "?")).text_color(t.background).text_size(11).font_semibold().child(letter);
  }

  dot(status) {
    const t = theme();
    return div().size(6).flex_none().rounded(3).bg(status === "working" ? t.working : status === "blocked" ? t.blocked : t.dim);
  }

  // A markdown block, selectable.
  md(key, text) {
    return div().on_mouse_down("left", stop).child(TextView.markdown(`md-${key}`, text).selectable(true));
  }

  // What a loaded link shows under its row.
  loadedBlock(key) {
    const t = theme(), l = this.loaded[key];
    if (!this.open[key] || !l) return null;
    const body = l.loading ? div().text_size(12).text_color(t.dim).child("Loading…")
      : l.error ? div().text_size(12).text_color(t.blocked).child(l.error)
      : div().id(`loaded-${key}`).max_h(360).overflow_y_scrollbar().on_mouse_down("left", stop).text_size(12.5).child(this.md(key, l.text));
    return div().px(10).pb(10).child(body);
  }

  // The line under a row's headline.
  metaOf(item) {
    const task = taskOf(item)?.id;
    if (item.section === "you") {
      const i = recIndex(item);
      return [item.project, task, i >= 0 ? `Herdra: ${optionOf(item.options[i]).title}` : null, `raised ${ago(item.at)}`];
    }
    if (item.section === "progress") return [item.project, task, item.agent ? item.agent.name : item.on];
    if (item.section === "next") return [item.project, task, item.waiting];
    return [item.project, task, item.id];
  }

  rightOf(item) {
    const t = theme(), out = [];
    if (item.section === "you" && item.kind) out.push(this.pill(item.kind, t.working, true));
    if (item.section === "progress" && item.agent) {
      const s = item.agent.status;
      out.push(this.pill(s, s === "working" ? t.working : s === "blocked" ? t.blocked : t.dim));
      if (s === "working" && item.since) out.push(div().text_size(11.5).text_color(t.dim).child(dur(item.since)));
      else if (item.silent?.at) out.push(div().text_size(11.5).text_color(t.dim).child(`idle ${dur(item.silent.at)}`));
    }
    if (item.section === "next" && String(item.on).toLowerCase() === "algorant") out.push(this.pill("yours", t.muted));
    if (item.section === "done" && item.closedAt) out.push(div().text_size(11.5).text_color(t.dim).child(ago(item.closedAt)));
    out.push(div().text_size(14).text_color(t.dim).child("›"));
    return out;
  }

  // One list row; a click opens the item's detail view. `opts.num`: its place in Up next.
  row(item, first, opts = {}) {
    const t = theme();
    return h_flex().id(`row-${item.key}`).when(!first, (el) => el.border_t(1).border_color(t.border)).px(10).py(8).gap(10).items_start().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.select(item.id, cx))
      .when(item.section === "done", (el) => el.child(div().mt(1).flex_none().w(12).text_size(12).text_color(t.done).child("✓")))
      .when(opts.num != null, (el) => el.child(div().mt(2).flex_none().w(14).flex().justify_end().text_size(11.5).text_color(t.dim).child(String(opts.num))))
      .child(this.chipOf(item.project))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(13).text_color(t.foreground).truncate().child(item.headline))
        .child(div().text_size(11.5).text_color(t.dim).truncate().child(this.metaOf(item).filter(Boolean).join(" · "))))
      .child(h_flex().flex_none().mt(1).gap(6).items_center().children(this.rightOf(item)));
  }

  card(...children) {
    const t = theme();
    return v_flex().rounded(8).overflow_hidden().bg(t.chrome).border_1().border_color(t.border).children(children);
  }

  note(text) {
    const t = theme();
    return div().px(10).py(9).rounded(8).bg(t.chrome).border_1().border_color(t.border).text_size(12.5).text_color(t.muted).child(text);
  }

  heading(title, count, about, urgent) {
    const t = theme();
    return h_flex().gap(8).items_center().px(2)
      .child(div().flex_none().text_size(12.5).font_semibold().child(title))
      .child(div().flex_none().h(18).min_w(18).px(5).rounded(9).flex().items_center().justify_center()
        .bg(urgent ? t.working : t.raised).text_color(urgent ? t.background : t.muted).text_size(11).font_semibold().child(String(count)))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(about ?? ""));
  }

  // Pending also lists the machine-gated Tasks from the board read, after its items.
  section(snap, [key, title, about, empty]) {
    const fast = snap.fast, items = fast?.[key] ?? [], gated = key === "pending" ? snap.board?.pending ?? [] : [];
    const n = items.length + gated.length;
    return v_flex().gap(8)
      .child(this.heading(title, n, n ? about : "", key === "you" && n > 0))
      .child(!fast ? this.note("Reading…")
        : n ? this.card(...items.map((it, i) => this.row(it, i === 0, key === "next" ? { num: i + 1 } : {})),
          ...gated.map((g, i) => this.taskRow(g, items.length + i === 0))) : this.note(empty));
  }

  // One line under the header: each Ceph's dot, Herdra included, and any machine that is offline.
  fleetStrip(fast) {
    const t = theme();
    if (!fast) return null;
    const cephs = (fast.fleet ?? []).map((c) => h_flex().flex_none().gap(5).items_center().text_color(c.status === "working" ? t.foreground : t.muted)
      .child(this.dot(c.status)).child(c.name));
    const off = (fast.offline ?? []).map((m) => div().flex_none().text_color(t.dim).child(`${m} offline`));
    return h_flex().w_full().flex_wrap().px(14).py(7).gap(14).items_center().border_b(1).border_color(t.border).text_size(11.5).children([...cephs, ...off]);
  }

  // Validation and delivered Tasks on the boards that no open item links to: a count, expanded on Show.
  boardBar(snap) {
    const t = theme(), tasks = snap.board?.tasks;
    const linked = new Set(itemsOf(snap.fast).filter((i) => i.section !== "done").flatMap((i) => i.links.filter((l) => l.kind === "task").map((l) => `${norm(l.project ?? i.project)}:${l.id}`)));
    const items = (tasks ?? []).filter((x) => !linked.has(`${norm(x.project)}:${x.id}`)), n = items.length, open = Boolean(this.more.board);
    const preview = items.slice(0, 4).map((x) => `${x.project} ${x.id.replace(/^task-/, "")}`).join(", ");
    return v_flex().flex_none().border_t(1).border_color(t.border)
      .when(open && n > 0, (el) => el.child(div().id("board-list").max_h(260).overflow_y_scrollbar().px(14).pt(10).on_mouse_down("left", stop)
        .child(this.card(...items.map((it, i) => this.taskRow(it, i === 0))))))
      .child(h_flex().px(14).py(8).gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().child(!tasks ? "On boards, not raised · reading…" : `On boards, not raised · ${n}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(open || !n ? "" : `waiting on someone: ${preview}`))
        .when(n > 0, (el) => el.child(this.action("hd-board", open ? "Hide ‹" : "Show ›", (_e, cx) => { this.more.board = !this.more.board; cx.notify(); }, t.accent))));
  }

  // A board Task no item links to: a click loads and expands its summary (`tandem show`, only then: a
  // refresh stays one `tandem list` per board). A machine-gated Task is on a board nobody read here.
  taskRow(task, first) {
    const t = theme(), open = Boolean(this.open[task.key]), post = this.loaded[task.key]?.post ?? null;
    const meta = [...task.meta, task.at ? `${task.atLabel ?? ""} ${ago(task.at)}`.trim() : null].filter(Boolean).join(" · ");
    const act = post ? this.action(`post-${task.key}`, "Post ↗", () => this.openPost(post), t.accent)
      : task.go ? this.action(`go-${task.key}`, "Conversation →", () => this.goTo(task.go.terminal), t.accent) : null;
    const body = open ? this.loadedBlock(task.key) : null;
    return v_flex().when(!first, (el) => el.border_t(1).border_color(t.border))
      .child(h_flex().id(`row-${task.key}`).px(10).py(8).gap(10).items_start().cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.toggle(task.key, task.state === "pending" ? null : () => taskText(task.project, task.id), cx))
        .child(this.chipOf(task.project))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(13).text_color(t.foreground).when(!open, (el) => el.truncate()).child(task.headline))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(meta)))
        .child(h_flex().flex_none().mt(1).children(act ? [act] : [])))
      .when(Boolean(body), (el) => el.child(div().pl(30).child(body)));
  }

  // ---- the detail view ----

  label(text) {
    const t = theme();
    return div().px(2).pb(6).text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());
  }

  block(text) {
    const t = theme();
    return div().px(12).py(10).rounded(8).bg(t.chrome).border_1().border_color(t.border).text_size(12.5).child(text);
  }

  optionBlock(item) {
    const t = theme(), rec = recIndex(item);
    return item.options.map((s, i) => {
      const o = optionOf(s), on = i === rec;
      return h_flex().gap(10).items_start().px(10).py(9).mt(i ? 6 : 0).rounded(8).bg(t.chrome).border_1().border_color(on ? t.accent : t.border)
        .child(div().size(20).flex_none().rounded(10).flex().items_center().justify_center().text_size(11)
          .when(on, (el) => el.bg(t.accent).text_color(t.background).font_semibold())
          .when(!on, (el) => el.border_1().border_color(t.border).text_color(t.muted))
          .child(String.fromCharCode(65 + i)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center().child(div().text_size(13).child(o.title))
            .when(on, (el) => el.child(div().flex_none().px(6).rounded(8).text_size(10.5).font_semibold().bg(t.accent).text_color(t.background).child("Herdra recommends"))))
          .when(Boolean(o.detail), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(o.detail))));
    });
  }

  linkRow(snap, item, l, i) {
    const t = theme(), key = `${item.id}-${i}`;
    const row = (k, value, actions) => v_flex().when(i > 0, (el) => el.border_t(1).border_color(t.border))
      .child(h_flex().px(10).py(7).gap(10).items_center()
        .child(div().w(56).flex_none().text_size(11.5).text_color(t.dim).child(k))
        .child(div().flex_1().min_w(0).truncate().child(value))
        .children(actions))
      .when(Boolean(this.loadedBlock(key)), (el) => el.child(this.loadedBlock(key)));
    if (l.kind === "task") {
      const project = l.project ?? item.project;
      const bt = snap.board?.tasks.find((x) => norm(x.project) === norm(project) && x.id === l.id);
      const post = bt?.post ?? this.loaded[key]?.post;
      return row("Task", `${l.id}${bt ? ` · ${bt.title}` : ""}  ·  ${project} board${bt ? ` · ${bt.state}` : ""}`, [
        ...(post ? [this.action(`post-${key}`, "Post ↗", () => this.openPost(post), t.accent)] : []),
        this.action(`task-${key}`, this.open[key] ? "Hide ‹" : "Summary ›", (_e, cx) => this.toggle(key, () => taskText(project, l.id), cx), t.accent),
      ]);
    }
    if (l.kind === "post") return row("Post", l.target, [this.action(`post-${key}`, "Open ↗", () => this.openPost(l.target), t.accent)]);
    if (l.kind === "file") return row("File", l.target, []);
    if (l.kind === "agent") {
      const a = l.agent;
      return row("Agent", a ? `${a.name} · ${a.status} · ${a.address}` : `${l.target} · gone`,
        a ? [this.action(`go-${key}`, "Conversation →", () => this.goTo(a.address), t.accent)] : []);
    }
    return row("Thread", l.target, [this.action(`thread-${key}`, this.open[key] ? "Hide ‹" : "Show ›", (_e, cx) => this.toggle(key, () => threadText(l.target), cx), t.accent)]);
  }

  detailHeader(item) {
    const t = theme(), task = item && taskOf(item)?.id;
    return h_flex().h(42).flex_none().pl(8).pr(6).gap(8).items_center().border_b(1).border_color(t.border)
      .child(this.action("hd-back", "‹ All", (_e, cx) => this.select(null, cx), t.accent))
      .when(Boolean(item), (el) => el.child(this.chipOf(item.project, false))
        .child(div().flex_1().min_w(0).truncate().font_medium().child([item.project, task].filter(Boolean).join(" · ")))
        .when(Boolean(item.kind), (el2) => el2.child(this.pill(item.kind, t.working, true))))
      .when(!item, (el) => el.child(div().flex_1()))
      .child(this.action("hd-close", "✕", () => this.dismiss()));
  }

  detailBody(snap, item) {
    const t = theme();
    if (!item) return v_flex().id("hd-detail").flex_1().min_h(0).w_full().px(14).py(12).child(this.note("This item is no longer in Herdra's list."));
    const done = item.section === "done", label = SECTIONS.find((s) => s[0] === item.section)?.[1];
    const meta = [label, done ? `closed ${ago(item.closedAt)}` : `raised by Herdra ${ago(item.at)}`,
      !done && item.waiting ? `waiting: ${item.waiting}` : null, !done && item.closes ? `closes when ${item.closes}` : null].filter(Boolean).join(" · ");
    const rec = recIndex(item);
    return v_flex().id("hd-detail").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(14).py(12).gap(14)
      .on_mouse_down("left", stop)
      .child(v_flex().gap(3)
        .child(div().text_size(17).font_semibold().child(item.what))
        .child(div().text_size(11.5).text_color(t.dim).child(meta)))
      .when(done, (el) => el.child(v_flex().child(this.label("Outcome")).child(this.block(item.note || "Closed."))))
      .when(Boolean(item.ask) || !done, (el) => el.child(v_flex().child(this.label(done ? "What was asked" : "What's asked"))
        .child(this.block(this.md(`${item.id}-ask`, item.ask ?? item.what)))))
      .when(!done && item.options.length > 0, (el) => el.child(v_flex().child(this.label("Options")).children(this.optionBlock(item))))
      .when(!done && Boolean(item.rec), (el) => el.child(v_flex().child(this.label("Herdra's recommendation"))
        .child(div().px(12).py(9).rounded(8).bg(t.chrome).border_1().border_color(rec >= 0 ? t.accent : t.border).text_size(12.5).child(this.md(`${item.id}-rec`, item.rec)))))
      .when(item.links.length > 0, (el) => el.child(v_flex().child(this.label("Links"))
        .child(this.card(...item.links.map((l, i) => this.linkRow(snap, item, l, i))))))
      .child(v_flex().child(this.label("History"))
        .child(this.card(...historyOf(item).map((h, i) => h_flex().px(10).py(7).gap(10).items_center().when(i > 0, (el) => el.border_t(1).border_color(t.border))
          .child(div().w(72).flex_none().text_size(11.5).text_color(t.dim).child(ago(h.at)))
          .child(div().flex_1().min_w(0).text_size(12.5).child(h.text))))));
  }

  detailBar(item) {
    const t = theme();
    return h_flex().flex_none().px(14).py(8).gap(8).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(div().flex_none().child(item?.id ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("from herdra-open · the same entry Herdra's footer prints"))
      .child(this.action("hd-back2", "‹ All", (_e, cx) => this.select(null, cx), t.accent));
  }

  header(snap) {
    const t = theme(), fast = snap.fast, you = youOf(snap).length;
    const parts = fast ? [[you, "need you"], [fast.progress.length, "in progress"], [fast.next.length, "up next"]].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`) : [];
    const off = fast?.offline?.length ? `${fast.offline.join(", ")} offline` : null;
    const sub = this.error ? "Couldn't read the sources" : !fast ? "Reading…" : [...parts, off].filter(Boolean).join(" · ") || "Nothing waiting";
    return h_flex().h(42).flex_none().pl(14).pr(6).gap(4).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .child(div().size(7).flex_none().rounded(4).bg(this.error ? t.blocked : you ? t.working : t.accent))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Herdra"))
        .child(div().flex_1().min_w(0).truncate().font_medium().child(sub)))
      .when(Boolean(fast?.herdra), (el) => el.child(this.action("hd-herdra", "Herdra →", () => this.goTo(fast.herdra))))
      .child(this.action("hd-pair", props()?.pair ? "⤢ Solo" : "⤢ Pair", () => this.pairToggle()))
      .child(this.action("hd-close", "✕", () => this.dismiss()));
  }

  // The tab-row button, drawn like Sideshow's; lit while the window is open, the count in `working`.
  panelButton() {
    const t = theme(), on = Boolean(shared(KEY)), n = youOf(this.snap()).length;
    return h_flex().id("root").size_full().items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("hd-panel-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click(() => toggle())
        .when(Boolean(this.icon), (el) => el.child(svg(this.icon).size(14)))
        .child("Herdra")
        .when(n > 0, (el) => el.child(div().text_color(t.dim).child("·")).child(div().text_color(t.working).font_semibold().child(String(n)))));
  }

  // Open-to-first-draw, from the click's stamp to this first render, for Herdra to read in shared.json.
  measure(snap, cx) {
    this.measured = true;
    const ms = Date.now() - this.openAt;
    if (!Number.isFinite(ms) || ms < 0 || ms > 10000) return;
    const note = { ms, snapshot: Boolean(snap.fast), board: Boolean(snap.board) };
    console.log(`herdra window: first render ${ms} ms after open (${note.snapshot ? "from the snapshot" : "no snapshot yet"})`);
    cx.spawn(async () => { setShared("herdra.openMs", note); });
  }

  render(cx) {
    if (this.role !== "window") return this.role === "button" ? this.panelButton() : div();
    // The copy this one replaced runs its close() after this one's init: re-assert the open window's id.
    const me = props()?.overlay;
    if (me && shared(KEY) !== me) setShared(KEY, me);
    const t = theme(), snap = this.snap();
    if (!this.measured) this.measure(snap, cx);
    const root = v_flex().id("root").size_full().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13);
    if (this.sel) {
      const item = itemsOf(snap.fast).find((i) => i.id === this.sel) ?? null;
      return root.child(this.detailHeader(item)).child(this.detailBody(snap, item)).child(this.detailBar(item));
    }
    return root
      .child(this.header(snap))
      .child(this.fleetStrip(snap.fast) ?? div())
      .child(v_flex().id("hd-body").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(14).py(12).gap(16)
        .on_mouse_down("left", stop)
        .when(Boolean(this.error), (el) => el.child(div().px(12).py(10).rounded(8).bg(t.chrome).border_1().border_color(t.border).text_color(t.blocked).child(this.error)))
        .children(SECTIONS.map((s) => this.section(snap, s))))
      .child(this.boardBar(snap));
  }

  async close() {
    if (this.role !== "window") return;
    if (shared(KEY) === props()?.overlay) setShared(KEY, null);
  }
}
