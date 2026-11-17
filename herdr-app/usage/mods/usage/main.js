// Usage in Herdr (Herdra task-52): the four subscription plans (Codex, Claude, Grok, OpenCode Go)
// in a window under the Usage button of main-sideshow's tab row, drawn as the Omarchy panel does:
// provider tabs, the plan, account limits with their resets, tokens by day, tokens by model.
// Three roles, like the Herdra and Sideshow mods:
//   props.button   the "Usage" pill in the tab row: click opens the window, click again closes it
//   mod.open       a tiny popup (mod.json) that toggles the window and closes itself
//   window         the window itself (props.window): it stays until the pill or Esc closes it;
//                  a click elsewhere does not. It owns the shared note of its overlay id (set in init,
//                  cleared in close()); toggle() only reads it, as Herdra's and Sideshow's do.
// Every figure comes from the records collect.mjs (in this folder) writes on OWNER; this widget
// never fetches usage or reads credentials. Nothing runs in the background: the collector runs
// only when the window opens and when asked.
//   opening the window:   node collect.mjs --open      (a provider at most every 3 min)
//   "Refresh":            node collect.mjs --refresh
// The window re-reads the records every 30 s while open (ages and countdowns stay true).
// Where the collector's host is another machine, records are read and the collector run there
// (hc), and if it can't be reached the window says so: it never fetches locally in its place.
// Colours: only the theme's UI keys (foreground, muted, dim and the surfaces). The caution and
// limit colours (ansi3, blocked) appear only on usage bars and their percentages.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, appHome, hc, exec, readTextFile, shared, setShared, openOverlay, closeOverlay, props, layout, writeTextFile } from "herdr";
import { mkdir } from "fs/promises";
import { OWNER, PROVIDERS, parseRecord, limitsView, planView, tokensView, tokens as fmtTokens, countdown, clock } from "./data.js";

const KEY = "usage.window";         // shared: the open window's overlay id, which lights the pill
const TAB_ROW_PAD = 8;              // the work area's padding when a layout does not say
const WIDTH = 420;                  // the window, logical px at zoom 1
const PAD = 16;
const REREAD_MS = 30_000;           // the open window re-reads the records (and redraws ages)
const OWN_MS = 5_000;               // the open window re-asserts its id (a hot reload can clear it)
const MAX_H = 880;                  // the window's height at most, logical px at zoom 1
const DAY_LABEL_W = 46, DAY_VALUE_W = 54, GAP = 10;
const MODELS_SHOWN = 6;

// The app draws images only from real files under its home, and mods/usage may be a link into the
// Herdra repo (it draws nothing through a link), so each copy of this mod copies its SVGs into
// data/usage/assets/ and draws those copies, once they exist: a path drawn before its file exists
// stays blank. Compare first and write only when different (expected = what is there now).
const ASSETS = ["usage", ...PROVIDERS.map((p) => p.id)];   // assets/<name>.svg; a provider's file is named for its id
async function installAssets() {
  const home = appHome();
  await mkdir(`${home}/data/usage/assets`, { recursive: true });
  for (const name of ASSETS) {
    const src = await readTextFile(`${home}/mods/usage/assets/${name}.svg`);
    if (src === null) throw new Error(`mods/usage/assets/${name}.svg is missing`);
    const path = `${home}/data/usage/assets/${name}.svg`, cur = await readTextFile(path);
    if (cur !== src) await writeTextFile(path, src, cur);
  }
}
const PILL_ICON = "data/usage/assets/usage.svg";

const reason = (e) => String(e?.message ?? e).split("\n")[0];

// Where the records are and how to run the collector: on this machine when it is OWNER, else on OWNER through hc.
async function locate() {
  const r = await hc(["server", "status", "--json"]);
  if (r.code !== 0) throw new Error("hc server status failed");
  const name = JSON.parse(r.stdout)?.core?.name;
  if (typeof name !== "string" || !name) throw new Error("this machine's name is unknown");
  if (name === OWNER) return { on: null, dir: `${appHome()}/data/usage`, script: `${appHome()}/mods/usage/collect.mjs` };
  const h = await exec("printenv", ["HOME"], { on: OWNER });
  const home = h.stdout.trim();
  if (h.code !== 0 || !home) throw new Error(`${OWNER}: home unknown`);
  return { on: OWNER, dir: `${home}/.config/herdr-app/data/usage`, script: `${home}/.config/herdr-app/mods/usage/collect.mjs` };
}

async function runCollector(where, flag) {
  const r = await exec("node", [where.script, flag], { on: where.on });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.code}`);
}

function readRecords(where) {
  return Promise.all(PROVIDERS.map((p) =>
    readTextFile(`${where.dir}/${p.id}.json`, { on: where.on }).then(parseRecord, (e) => ({ state: "error", error: `${OWNER}: ${reason(e)}` }))));
}

// The only colours besides the theme's UI keys: ochre from 75% and red from 90%, on bars and percentages.
const tone = (t, pct, quiet) => (pct >= 90 ? t.blocked : pct >= 75 ? t.ansi3 : quiet);

const stop = (_e, cx) => cx.stop_propagation();

function find(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// viewport_size() is physical pixels; overlay geometry and layout sizes are logical pixels.
function spot() {
  const vp = window.viewport_size(), L = layout(), zoom = Number(settings().zoom ?? 1);
  const px = (id, d) => { const n = find(L, id); return !n || n.hidden ? 0 : n.size?.px ?? d; };
  const body = find(L, "work-body");
  const pad = Array.isArray(body?.padding) ? body.padding[1] : body?.padding ?? TAB_ROW_PAD;
  const row = find(L, "tab-row"), rowH = px(row ? "tab-row" : "tabs", 42);
  const kids = row?.children ?? [];
  const mine = kids.findIndex((c) => c.id === "usage-button");
  const after = mine < 0 ? 0 : kids.slice(mine + 1).reduce((sum, c) => sum + (c.hidden ? 0 : c.size?.px ?? 0), 0);
  const viewportWidth = vp.width / zoom, viewportHeight = vp.height / zoom;
  const width = Math.max(0, Math.min(WIDTH, viewportWidth - pad - after));
  const height = Math.max(0, Math.min(MAX_H, viewportHeight - rowH - 2 * pad - px("status", 28)));
  const x = viewportWidth - after - width;
  return { width, height, at: { x: Math.round(x), y: Math.round(rowH + pad) } };
}

// Opens or closes the window, as the Herdra and Sideshow toggles do. Synchronous: an overlay opened
// after an await never shows. It does not note the open window: the window notes itself in init and
// forgets in close(), so the note can only be this window's. A window stays open until closed (a
// click beside it does nothing), so the pill's second click closes it.
function toggle(done) {
  const open = shared(KEY);
  if (open) { closeOverlay(open); setShared(KEY, null); done?.(); return; }
  const fit = spot();
  openOverlay({ mod: "usage", props: { window: true }, kind: "window", frame: "none", key: "usage", ...fit });
  done?.();
}

export default class Usage extends View {
  init(_props, cx) {
    if (props()?.button) {
      this.role = "button";
      this.icons = false;   // the pill's icon is drawn once its copy exists
      cx.spawn(async (cx) => {
        try { await installAssets(); this.icons = true; cx.notify(); } catch (e) { console.error(`usage button icon: ${reason(e)}`); }
      });
      // This copy starts when the app or the layout does, when no Usage window can be open (it is not
      // kept), so any id left in shared.json by a crash or a missed close() is stale: forget it, or the
      // first press would only clear it. (A hot reload runs this too; an open window re-asserts its id.)
      setShared(KEY, null);
      return;
    }
    if (props()?.overlay && !props().window) {   // opened by mod.open: toggle, then go
      this.role = "toggle";
      const me = props().overlay;
      toggle(() => closeOverlay(me));
      return;
    }
    this.role = "window";
    this.innerWidth = WIDTH - 2 * PAD;
    this.dayBarWidth = Math.max(0, this.innerWidth - DAY_LABEL_W - DAY_VALUE_W - 2 * GAP);
    this.closed = false;             // set in close(): nothing of this window runs after that
    this.own();                      // the window owns the note: set here, synchronously, cleared in close()
    this.keys = cx.focus_handle();   // Esc closes the window once it has the keyboard; taken on a press inside the window only, as Sideshow does
    this.tab = PROVIDERS[0].id;
    this.where = null;      // locate()'s answer
    this.records = null;    // parsed records by provider, null until the first read
    this.problem = null;    // why the records can't be read
    this.runError = null;   // the last collector run's failure
    this.busy = false;      // a collector run is under way
    this.icons = false;     // the provider marks are drawn once their copies exist
    cx.spawn(async (cx) => {
      try { await installAssets(); if (!this.closed) { this.icons = true; cx.notify(); } } catch (e) { console.error(`usage provider marks: ${reason(e)}`); }
    });
    cx.spawn(async (cx) => {
      await this.reread(cx);
      await this.collect("--open", cx);
    });
    cx.timer.every(REREAD_MS, (cx) => cx.spawn((cx) => this.reread(cx)));
    cx.timer.every(OWN_MS, () => this.own());
  }

  // A hot reload can clear the note of this window (the old copy's close() runs last): put it back.
  // Never after this window's own close(), so a closed window cannot restore its stale id.
  own() {
    const id = props()?.overlay;
    if (!this.closed && id && shared(KEY) !== id) setShared(KEY, id);   // a no-op under `herdr-app check`, which has no overlay id
  }

  async reread(cx) {
    try {
      this.where ??= await locate();
      const records = await readRecords(this.where);
      if (this.closed) return;
      this.records = records;
      this.problem = null;
    } catch (e) {
      if (this.closed) return;
      this.where = null;
      this.records = null;
      this.problem = `cannot read the collector's records: ${reason(e)}`;
    }
    cx.notify();
  }

  async collect(flag, cx) {
    if (this.busy || !this.where) return;
    this.busy = true;
    cx.notify();
    try {
      await runCollector(this.where, flag);
      this.runError = null;
    } catch (e) {
      this.runError = `collector failed on ${OWNER}: ${reason(e)}`;
    }
    if (this.closed) return;
    this.busy = false;
    await this.reread(cx);
  }

  // The tab-row pill, drawn like the Sideshow and Herdra buttons; lit while the window is open.
  button() {
    const t = theme(), on = Boolean(shared(KEY));
    return h_flex().id("root").size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("us-panel-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click(() => toggle())
        .when(this.icons, (el) => el.child(svg(PILL_ICON).size(14)))
        .child("Usage"));
  }

  caption(left, right, rightColor) {
    const t = theme();
    return h_flex().justify_between().items_center().gap(8)
      .child(div().text_size(10.5).text_color(t.dim).child(left.toUpperCase()))
      .when(Boolean(right), (el) => el.child(div().flex_none().text_size(10.5).text_color(rightColor ?? t.dim).child(right)));
  }

  // The state chip: dim when fresh, muted otherwise (stale with its age, or unavailable).
  chip(v) {
    const t = theme();
    return v.state === "fresh" ? [`as of ${v.age}`, t.dim] : v.state === "stale" ? [`stale · ${v.age}`, t.muted] : ["unavailable", t.muted];
  }

  section(id) {
    const t = theme();
    return v_flex().id(id).gap(12).pt(14).pb(16).border_t(1).border_color(t.border);
  }

  // One account limit: label and percentage, a thin bar, and the reset under it.
  limit(p, w, i, now) {
    const t = theme();
    const key = `${p.id}-w${i}`;
    const number = w.kind === "fresh" || w.kind === "stale";
    const pct = number ? Math.max(0, Math.min(100, w.pct)) : 0;
    const color = number ? tone(t, pct, w.kind === "stale" ? t.muted : t.foreground) : t.dim;
    const under = w.kind === "reset"
      ? `Reset ${clock(w.resetMs, now)}, after this reading; current usage unknown`
      : w.kind === "unavailable" ? w.note
        : w.resetMs !== undefined ? `Resets in ${countdown(w.resetMs - now)} · ${clock(w.resetMs, now)}` : "Reset time unknown";
    return v_flex().id(key).gap(6)
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(13.5).child(w.label))
        .child(div().text_size(13.5).text_color(number ? color : t.foreground).child(number ? `${Math.round(w.pct)}%` : "—")))
      .child(div().w(this.innerWidth).h(6).rounded(3).bg(t.hover)
        .when(number, (el) => el.child(div().h(6).w(Math.round((this.innerWidth * pct) / 100)).rounded(3).bg(color))))
      .child(div().text_size(11.5).text_color(t.dim).child(under));
  }

  limits(p, rec, now) {
    const t = theme();
    const v = limitsView(rec, p.id, now);
    const chip = this.chip(v);
    return this.section(`${p.id}-limits`)
      .child(this.caption("Limits · account", chip[0], chip[1]))
      .children(v.windows.map((w, i) => this.limit(p, w, i, now)))
      .when(Boolean(v.reason), (el) => el.child(div().text_size(12).text_color(t.muted)
        .child(v.state === "unavailable" ? v.reason : `Last attempt failed: ${v.reason}`)));
  }

  dayRow(p, d, max, i) {
    const t = theme();
    const known = typeof d.tokens === "number";
    return h_flex().id(`${p.id}-d${i}`).h(18).gap(GAP).items_center()
      .child(div().w(DAY_LABEL_W).flex_none().text_size(11.5).text_color(d.today ? t.foreground : t.dim).when(d.today, (el) => el.font_semibold()).child(d.label))
      .child(div().w(this.dayBarWidth).h(4).flex_none().rounded(2).bg(t.hover)
        .when(known && max > 0, (el) => el.child(div().h(4).w(Math.max(d.tokens > 0 ? 2 : 0, Math.round((this.dayBarWidth * d.tokens) / max))).rounded(2).bg(d.today ? t.foreground : t.muted))))
      .child(div().w(DAY_VALUE_W).flex_none().text_right().text_size(11.5).text_color(d.today ? t.foreground : t.dim).when(d.today, (el) => el.font_semibold())
        .child(known ? fmtTokens(d.tokens) : "–"));
  }

  tokensByDay(p, v) {
    const t = theme();
    const where = v.host ? v.host : OWNER;
    const chip = this.chip(v);
    const sec = this.section(`${p.id}-days`).child(this.caption(`Tokens by day · ${where}`, chip[0], chip[1]));
    if (v.state === "unavailable") return sec.child(div().text_size(12).text_color(t.muted).child(v.reason));
    const max = Math.max(0, ...v.days.map((d) => d.tokens ?? 0));
    return sec.child(v_flex().gap(7).children(v.days.map((d, i) => this.dayRow(p, d, max, i))))
      .when(Boolean(v.note), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(v.note)));
  }

  tokensByModel(p, v) {
    const t = theme();
    const where = v.host ? v.host : OWNER;
    const sec = this.section(`${p.id}-models`).child(this.caption(`Tokens by model · ${where} · 7 days`));
    if (v.state === "unavailable") return sec.child(div().text_size(12).text_color(t.muted).child(v.reason));
    if (v.models.length === 0) return sec.child(div().text_size(12).text_color(t.muted).child("No usage in the last 7 days."));
    const shown = v.models.slice(0, MODELS_SHOWN), max = shown[0].tokens;
    return sec.child(v_flex().gap(6).children(shown.map((m, i) =>
      div().id(`${p.id}-m${i}`).relative().w(this.innerWidth).h(30).rounded(6).overflow_hidden().bg(t.hover)
        .child(div().absolute().top(0).left(0).h(30).w(Math.max(2, Math.round((this.innerWidth * m.tokens) / max))).bg(t.selected))
        .child(h_flex().absolute().top(0).left(0).h(30).w(this.innerWidth).px(10).items_center().justify_between().text_size(12)
          .child(div().truncate().child(m.model))
          .child(div().flex_none().text_color(t.muted).child(fmtTokens(m.tokens))))
    ))).when(v.models.length > MODELS_SHOWN, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`+ ${v.models.length - MODELS_SHOWN} more`)));
  }

  tab_(p) {
    const t = theme(), on = p.id === this.tab;
    return h_flex().id(`tab-${p.id}`).flex_1().h(30).items_center().justify_center().rounded(6).border_1()
      .border_color(on ? t.muted : t.border).bg(on ? t.selected : t.chrome).text_size(12).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click((_e, cx) => { this.tab = p.id; cx.notify(); })
      .child(p.tab);
  }

  window() {
    const t = theme(), now = Date.now();
    const p = PROVIDERS.find((x) => x.id === this.tab);
    const rec = this.records ? this.records[PROVIDERS.indexOf(p)] : { state: "missing" };
    const plan = planView(rec, now);
    // A card like the Herdra and Sideshow windows. The hero drags it (a press nothing stops drags it).
    const root = v_flex().id("root").relative().size_full().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_size(12).text_color(t.foreground)
      .track_focus(this.keys).on_key_down((e, cx) => { if (e.keystroke === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); } })
      .on_size_change((size, cx) => {
        this.innerWidth = Math.max(0, size.width - 2 * PAD);
        this.dayBarWidth = Math.max(0, this.innerWidth - DAY_LABEL_W - DAY_VALUE_W - 2 * GAP);
        cx.notify();
      });
    const body = v_flex().id("body").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(PAD).pb(10).on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.keys.focus(); });
    root.child(h_flex().id("hero").items_center().gap(12).px(PAD).pt(PAD).pb(16)
      .child(this.icons ? svg(p.icon).size(34).flex_none().text_color(t.foreground) : div().size(34).flex_none())
      .child(v_flex().flex_1().gap(2)
        .child(div().text_size(20).font_medium().child(p.name))
        .child(div().text_size(11).text_color(plan?.stale ? t.muted : t.dim)
          .child(plan ? (plan.stale ? `${plan.label.toUpperCase()} · as of ${plan.age ?? "unknown"}` : plan.label.toUpperCase()) : this.records ? "PLAN UNKNOWN" : "")))
      .child(h_flex().id("refresh").flex_none().px(8).py(4).rounded(5).text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => cx.spawn((cx) => this.collect("--refresh", cx)))
        .child(this.busy ? "Refreshing…" : "Refresh")));
    body.child(h_flex().gap(8).pb(16).children(PROVIDERS.map((x) => this.tab_(x))));
    if (this.problem || this.runError) {
      body.child(div().pb(10).text_size(11.5).text_color(t.muted).child(this.problem ?? this.runError));
    }
    if (this.records === null && !this.problem) {
      return root.child(body.child(div().py(10).text_size(12).text_color(t.muted).child("Reading the records…")));
    }
    if (this.records === null) return root.child(body);
    body.child(this.limits(p, rec, now));
    const tv = tokensView(rec, now);
    body.child(this.tokensByDay(p, tv));
    body.child(this.tokensByModel(p, tv));
    return root.child(body.child(div().pt(12).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child("Fetched when this opens (a provider at most every 3 min) and on Refresh · tokens from Pi sessions · Esc closes once you have clicked in it")));
  }

  render() {
    if (this.role === "toggle") return div();
    return this.role === "button" ? this.button() : this.window();
  }

  async close() {
    if (this.role !== "window") return;
    this.closed = true;
    this.keys?.release();
    if (shared(KEY) === props()?.overlay) setShared(KEY, null);
  }
}
