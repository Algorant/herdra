// Sideshow in Herdr: one Sideshow session drawn natively in a floating right-hand window as a
// running thread — its posts newest first, each with its retained rounds (v1…vN) and its comments,
// plus a picker for the other sessions and a local archive (task-114, replacing task-50's
// all-sessions feed). `mod.open:sideshow` (ctrl-shift-s) opens this mod as a tiny popup (mod.json)
// that toggles the window and closes itself; the window is this mod again, with props.window.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { exec, theme, settings, layout, props, appHome, shared, setShared, openOverlay, closeOverlay, readTextFile, writeTextFile } from "herdr";

// The app draws images only from real files under its home, and mods/sideshow links into the Herdra
// repo, so the button copies its icon into data/sideshow/ and draws that copy.
async function installIcon() {
  const src = await readTextFile(`${appHome()}/mods/sideshow/sideshow.svg`);
  if (src === null) throw new Error("mods/sideshow/sideshow.svg is missing");
  const path = `${appHome()}/data/sideshow/sideshow.svg`, cur = await readTextFile(path);
  if (cur !== src) await writeTextFile(path, src, cur);
  return "data/sideshow/sideshow.svg";
}
import * as fs from "fs/promises";

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

// The app remembers where a window was in windows.json, per shown layout: `places[key]` is the spot
// it was last dragged to ([x, y]), and `kept[layout][key]` is the overlay spec a restart reopens it
// with. A place left over from a bigger app window is mostly outside this one, so the window reopens
// at the fit readerWindow() computes rather than staying off-view (task-132).

// The place the app opens this window at, from what it remembers; null when it remembers none. A
// dragged spot wins, as it does for the app; otherwise the kept spec's.
function rememberedPlace(file, key, layoutName, fit) {
  const spec = file?.kept?.[layoutName]?.[key], spot = file?.places?.[key];
  const size = Number(spec?.width) > 0 && Number(spec?.height) > 0
    ? { width: Number(spec.width), height: Number(spec.height) }
    : { width: fit.width, height: fit.height };
  if (Array.isArray(spot) && spot.length >= 2) {
    return { ...size, at: { x: Number(spot[0]), y: Number(spot[1]) }, dragged: true };
  }
  const at = spec?.at;
  if (Number.isFinite(Number(at?.x)) && Number.isFinite(Number(at?.y))) {
    return { ...size, at: { x: Number(at.x), y: Number(at.y) }, dragged: false };
  }
  return null;
}

// All of it inside the app window: a place even partly past an edge is one the person cannot reach.
function insideWindow(place, viewport) {
  return place.at.x >= 0 && place.at.y >= 0
    && place.at.x + place.width <= viewport.width && place.at.y + place.height <= viewport.height;
}

// The one place this run has already re-placed, so a stale place the app keeps reusing cannot make
// the window reopen for ever.
let replaced = null;

const KEY = "sideshow-work";                     // the solo window's overlay key: windows.json remembers its place
const PAIR_KEY = "sideshow-pair";                // the pair's right half (task-161), remembered apart from solo
const PAIR_GAP = 8;                              // between the pair's two halves, as the pane cards' gap
const OTHER = "herdra.window";                   // shared: the Herdra window's overlay id, paired or not
const DEFAULT_ORIGIN = "http://localhost:8228";  // the Sideshow server, unless the origin file names another
const ORIGIN_FILE = "data/sideshow/origin";      // under the app home: one line, e.g. http://workstation.<tailnet>.ts.net:8228
const ARCHIVE_FILE = "data/sideshow/archived";   // under the app home: one archived session id per line
const CACHE = "data/sideshow/assets";            // under the app home: the only place image() reads
const POLL_MS = 5000;                            // the session list, while the window is open
const IMG = /!\[([^\]]*)\]\(((?:\/a\/[0-9a-f]+)|(?:https?:\/\/[^)\s]+))\)/g;
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const SGR = /\x1b\[([0-9;?]*)([ -\/]*)([@-~])/g;  // an escape, split into its parameters and its final byte
const MAX_WIDTH = 960;                           // comfortable reading width on large displays
const PROSE_MAX = 1040;                          // prose's own cap, so a wider window never runs absurd lines
const PAD = 14, GAP = 12, RADIUS = 8, STRIP = 28;
const BLOCK_GAP = 10;                            // between the blocks of one markdown surface
const CODE_LINE = 18, CODE_MAX = 480;
const ROUNDS = 20;                               // Sideshow keeps this many versions per post
const PICKER_ROWS = 12;                          // sessions in the picker before "show all"
const ROUND_CHIPS = 6;                           // version chips before the first one folds to "…"

// The spot a window opens at: the solo reader, or one half of the pair.
const spot = (half) => readerWindow(layout(), window.viewport_size(), Number(settings().zoom ?? 1), MAX_WIDTH, half);

// ctrl-shift-s and the tab-bar button (main-sideshow): close the window if it's open; else open it.
// Open synchronously: a window opened from an async task after an await never shows.
function toggle(done) {
  const open = shared("sideshow.window");
  if (open) { closeOverlay(open); setShared("sideshow.window", null); done?.(); return; }
  const fit = spot(null);
  openOverlay({ mod: "sideshow", props: { window: true }, kind: "window", frame: "none", key: KEY, keep: true, ...fit });
  done?.();
}

// The project a session belongs to, from its cwd: a worktree maps to its repo
// (.../worktrees/<repo>/<branch>), else the folder under ~/Projects, else the home dot-folder (~/.pi).
function projectOf(cwd) {
  const parts = (cwd ?? "").split("/").filter(Boolean);
  const under = (dir) => { const i = parts.indexOf(dir); return i >= 0 ? parts[i + 1] : undefined; };
  if (under("worktrees")) return under("worktrees");
  if (under("Projects")) return under("Projects");
  if (parts[0] === "home" && parts[2]?.startsWith(".")) return parts[2];
  return parts[parts.length - 1] ?? "unknown";
}

// The Sideshow address this window was asked to open (Herdra's Post ↗ / Open ↗ rows hand over the
// post's or the session's own address): a post to open at, or a whole session. Absolute or a bare
// path, whatever the query or hash.
function linkOf(url) {
  const m = /\/(p|session)\/([A-Za-z0-9_-]+)/.exec(String(url ?? ""));
  return m ? { kind: m[1] === "p" ? "post" : "session", id: m[2] } : null;
}

// A project's chip colour: one of the theme's ANSI colours, by a hash of its name.
const chipColor = (project) => theme()[`ansi${1 + (parseInt(hash(project), 16) % 6)}`];
const stamp = (p) => p.updatedAt ?? p.createdAt;

// A terminal surface keeps the colours it was published with: its SGR escapes are drawn as styled
// text runs, and every other escape is dropped, as before. A program draws in SGR: a foreground
// colour, bold and dim, each switched back by a reset. The plain text is what Copy copies.

const CUBE = [0, 95, 135, 175, 215, 255];   // xterm's 6×6×6 colour cube
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
const rgb = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// A 256-colour index: the theme's own 16 colours by name, then the cube and the greys as hex.
function palette(n) {
  if (n < 16) return `ansi${n}`;
  if (n < 232) { const v = n - 16; return rgb(CUBE[Math.floor(v / 36) % 6], CUBE[Math.floor(v / 6) % 6], CUBE[v % 6]); }
  if (n < 256) return rgb(8 + 10 * (n - 232), 8 + 10 * (n - 232), 8 + 10 * (n - 232));
  return null;
}

// One SGR parameter list onto a run's style. A parameter that is not a foreground colour, bold, dim
// or a reset (backgrounds, underlines, the cursor) leaves the style alone.
function sgr(style, params) {
  const ps = params === "" ? [0] : params.split(";").map(Number);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!Number.isFinite(p)) continue;
    if (p === 0) { style.colour = null; style.bold = false; style.dim = false; }
    else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 22) { style.bold = false; style.dim = false; }
    else if (p >= 30 && p <= 37) style.colour = `ansi${p - 30}`;
    else if (p === 39) style.colour = null;
    else if (p >= 90 && p <= 97) style.colour = `ansi${p - 90 + 8}`;
    else if (p === 38 && ps[i + 1] === 5) { style.colour = palette(ps[i + 2]); i += 2; }
    else if (p === 38 && ps[i + 1] === 2 && ps.slice(i + 2, i + 5).every(Number.isFinite)) {
      style.colour = rgb(ps[i + 2], ps[i + 3], ps[i + 4]); i += 4;
    }
  }
}

// A terminal surface's text as lines of runs. A space is drawn non-breaking and a tab is drawn as
// spaces to the next 8-column stop, so a terminal's columns line up whatever the layout does to
// plain text. `styled` is false when nothing in the text carries a colour, bold or dim.
const NBSP = "\u00a0";
function ansiRuns(text) {
  const lines = [], style = { colour: null, bold: false, dim: false };
  let line = [], run = "", col = 0, at = 0;
  const draw = (s) => {
    let out = "";
    for (const ch of s) {
      if (ch === "\t") { const n = 8 - (col % 8); out += NBSP.repeat(n); col += n; }
      else { out += ch === " " ? NBSP : ch; col++; }
    }
    return out;
  };
  const flush = () => {
    if (run) { line.push({ text: run, colour: style.colour, bold: style.bold, dim: style.dim }); run = ""; }
  };
  const endLine = () => { flush(); lines.push(line); line = []; col = 0; };
  const write = (s) => {
    for (const [i, part] of s.split("\n").entries()) {
      if (i > 0) endLine();
      if (part) run += draw(part);
    }
  };
  for (const m of text.matchAll(SGR)) {
    write(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[3] !== "m" || m[2] || /[^0-9;]/.test(m[1])) continue;   // not SGR: dropped, as before
    flush();                              // the style changes here
    sgr(style, m[1]);
  }
  write(text.slice(at));
  endLine();
  while (lines.length && !lines[lines.length - 1].length) lines.pop();   // a trailing newline ends no line
  return { lines, styled: lines.some((l) => l.some((r) => r.colour || r.bold || r.dim)) };
}

// A run's colour: the theme's own for a 16-colour code, the literal for a 256-colour or truecolor one.
const ink = (run, t) => (run.colour === null ? t.foreground : run.colour.startsWith("#") ? run.colour : t[run.colour]);

// Text-like surfaces show in a read-only code editor.
function textOf(s) {
  switch (s.kind) {
    case "terminal": return { language: "text", value: (s.text ?? "").replace(ANSI, "").replace(/\n+$/, "") };
    case "code": return { language: s.language ?? "text", value: s.code ?? "" };
    case "diff": return { language: "diff", value: s.patch ?? (s.files ?? []).map((f) => `--- ${f.filename}\n${f.after}`).join("\n") };
    case "json": return { language: "json", value: JSON.stringify(s.data, null, 2) };
    case "mermaid": return { language: "text", value: s.mermaid ?? "" };
    default: return null;
  }
}

// What a block's caption strip calls it.
function labelOf(s) {
  if (s.title) return s.title;
  switch (s.kind) {
    case "terminal": return "Terminal";
    case "code": return s.language ?? "Code";
    case "diff": return s.files?.length ? s.files.map((f) => f.filename).join(", ") : "Diff";
    case "json": return "JSON";
    case "mermaid": return "Mermaid diagram";
    case "html": return "HTML";
    case "trace": return "Trace";
    default: return s.kind;
  }
}

// An html surface's words, for a short preview.
function htmlText(html) {
  return (html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// ---- markdown: this mod splits it, TextView draws it ----

// A fence's opener: at most three spaces of indent, then three or more of one marker character.
const fenceOpen = (line) => {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return m ? { char: m[1][0], len: m[1].length } : null;
};
// A fence's closer: the opener's character, at least as long, and nothing after it.
const fenceClose = (line, fence) => {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m) && m[1][0] === fence.char && m[1].length >= fence.len;
};

// A surface's markdown as a preamble plus its `## ` sections. Fenced code never splits, and a
// callout's `>` lines never start with `## `, so neither can break a block in two.
function splitSections(text) {
  const out = [{ title: null, lines: [] }];
  let fence = null;
  for (const line of text.split("\n")) {
    const target = out[out.length - 1];
    if (fence) { target.lines.push(line); if (fenceClose(line, fence)) fence = null; continue; }
    const open = fenceOpen(line);
    if (open) { fence = open; target.lines.push(line); continue; }
    const head = /^##\s+(.+)$/.exec(line);
    if (head) { out.push({ title: head[1].trim(), lines: [] }); continue; }
    target.lines.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.lines.join("\n") }));
}

// One run of prose as its blocks: a `> [!KIND]` callout, or prose that TextView draws whole.
function blocksOf(text) {
  const lines = text.split("\n"), blocks = [];
  let prose = [], fence = null;
  const flush = () => { const whole = prose.join("\n"); if (whole.trim()) blocks.push({ kind: "prose", text: whole }); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) { prose.push(line); if (fenceClose(line, fence)) fence = null; continue; }
    const open = fenceOpen(line);
    if (open) { fence = open; prose.push(line); continue; }
    const alert = /^>\s*\[!(DECIDE|NOTE|WARNING)\]\s*(.*)$/i.exec(line);
    if (!alert) { prose.push(line); continue; }
    flush();
    const run = alert[2].trim() ? [alert[2].trim()] : [];   // words on the marker's own line start the body
    while (i + 1 < lines.length && /^>/.test(lines[i + 1])) run.push(lines[++i].replace(/^>\s?/, ""));
    blocks.push({ kind: "callout", label: alert[1].toUpperCase(), text: run.join("\n") });
  }
  flush();
  return blocks;
}

// One option of a Decide box, in any form agents write it: `- **A — title.** words`, `- **A** words`,
// `1. words`, `2) words`, `- A. words`, `- A) words`. The rank is its chip (the leading letter or
// number, at most two characters), and the words are the rest, the bold title keeping its place.
// A bold title with no short rank in it (`- **Recommended — 1 and 2.** words`) has no rank of its
// own: rank is null and the title is kept to open its words, so decideOf can letter it by place.
function decideOption(line) {
  const s = line.trim();
  let rank = "", rest = "";
  if (/^[-*]\s+/.test(s)) {
    const body = s.replace(/^[-*]\s+/, ""), bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
    if (bold) {
      const split = /^([A-Za-z0-9]{1,2})\s*(?:[—–]|--?|[.:)])\s*(.*)$/.exec(bold[1]);
      if (!split) {   // a bold rank alone, or a bold title with no short rank in it
        const bare = /^[A-Za-z0-9]{1,2}$/.test(bold[1].trim());
        return bare ? { rank: bold[1].trim(), text: bold[2].trim() }
          : { rank: null, bold: bold[1].trim(), text: bold[2].trim() };
      }
      rank = split[1]; rest = `${split[2]} ${bold[2]}`;
    } else {
      const plain = /^([A-Za-z0-9]{1,2})\s*[.)]\s+(.*)$/.exec(body);
      if (!plain) return null;
      rank = plain[1]; rest = plain[2];
    }
  } else {
    const numbered = /^(\d{1,2})\s*[.)]\s+(.*)$/.exec(s);
    if (!numbered) return null;
    rank = numbered[1]; rest = numbered[2];
  }
  return { rank, text: rest.replace(/\s{2,}/g, " ").trim() };
}

// A Decide box's words: the question before the first option, the options themselves, the one marked
// recommended (-1 if none), the reason from a trailing `Recommendation: A, because …` line, and any
// paragraph after a blank line that ends the list. The reason's rank may be a letter or a number;
// either names an option's chip, a letter also by place. An option with no short rank of its own
// (`- **Recommended — 1 and 2.** words`) takes a letter chip by place, and so does every option when
// any one of them lacks a rank, so a mixed list stays consistent.
function decideOf(text) {
  const question = [], items = [], tail = [];
  let listed = false, closed = false, stated = "", rec = -1;
  for (const line of text.split("\n")) {
    if (stated) break;   // the reason ends the box: nothing after it is read
    if (listed) {
      const said = /^\s*recommendation\s*(?:[:—–]|-(?!-))\s*(.*)$/i.exec(line);
      if (said) { stated = said[1].trim(); closed = true; continue; }   // the reason, never an option's words
      if (closed) { tail.push(line); continue; }
      if (!line.trim()) { closed = true; continue; }   // a blank line ends the option list
      const option = decideOption(line);
      if (option) { items.push(option); continue; }
      const more = line.trim();
      if (more) items[items.length - 1].text = `${items[items.length - 1].text} ${more}`.trim();
      continue;
    }
    const option = decideOption(line);
    if (option) { listed = true; items.push(option); continue; }
    question.push(line);
  }
  if (items.some((it) => it.rank === null)) {   // one missing rank letters the whole list
    for (const [i, item] of items.entries()) {
      if (item.rank === null) item.text = `**${item.bold}** ${item.text}`.trim();
      item.rank = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
    }
  }
  let reason = "";
  if (stated) {
    const said = /^([A-Za-z]|\d{1,2})\b\s*[.,:;)—–-]?\s*(.*)$/.exec(stated);
    reason = said ? said[2].trim() : stated;
    const want = said?.[1].toLowerCase();
    const at = want === undefined ? -1 : items.findIndex((it) => it.rank.trim().toLowerCase() === want);
    rec = at >= 0 ? at
      : /^[a-z]$/.test(want) ? want.charCodeAt(0) - 97
      : Number(want) - 1;
    if (!(rec >= 0 && rec < items.length)) rec = -1;
  }
  let inline = -1;
  for (const [i, item] of items.entries()) {
    const mark = /\(recommended\)/i;
    if (!mark.test(`${item.rank} ${item.text}`)) continue;
    item.rank = item.rank.replace(mark, "").trim();
    item.text = item.text.replace(mark, "").replace(/\s{2,}/g, " ").trim();
    if (inline < 0) inline = i;
  }
  return { question: question.join("\n").trim(), items, rec: inline >= 0 ? inline : rec, reason, tail: tail.join("\n").trim() };
}

// The ranges of a text that are code — fenced blocks and inline backtick runs — where image
// markdown is a literal to show, not a picture to draw.
function codeRanges(text) {
  const ranges = [];
  let at = 0, fence = null, from = 0;
  for (const line of text.split("\n")) {
    if (fence) {
      if (fenceClose(line, fence)) { ranges.push({ start: from, end: at + line.length }); fence = null; }
    } else {
      const open = fenceOpen(line);
      if (open) { fence = open; from = at; }
    }
    at += line.length + 1;
  }
  if (fence) ranges.push({ start: from, end: text.length });
  const fenced = ranges.slice();
  let open = null;
  for (const m of text.matchAll(/`+/g)) {
    if (fenced.some((r) => m.index >= r.start && m.index < r.end)) continue;
    if (!open) { open = { len: m[0].length, start: m.index }; continue; }
    if (m[0].length !== open.len) continue;
    ranges.push({ start: open.start, end: m.index + m[0].length });
    open = null;
  }
  return ranges;
}

// A diagram's source: shown as one row, its code behind a click.
const isSource = (s) => s.kind === "mermaid" || (s.kind === "code" && (s.language === "mermaid" || s.title === "Mermaid source"));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stop = (_e, cx) => cx.stop_propagation();

export default class Sideshow extends View {
  init(_props, cx) {
    if (props()?.button) {   // the tab-bar button in main-sideshow
      this.role = "button";
      this.icon = null;
      cx.spawn(async (cx) => {
        try { this.icon = await installIcon(); cx.notify(); } catch (e) { console.error(`sideshow button icon: ${e?.message ?? e}`); }
      });
      return;
    }
    if (props()?.overlay && !props().window) {   // opened by mod.open: toggle, then go
      this.role = "toggle";
      const me = props().overlay;
      toggle(() => closeOverlay(me));
      return;
    }
    this.role = "window";
    this.origin = null;       // the server, read from the origin file
    this.sessions = [];       // every session, newest activity first
    this.shown = null;        // the session the thread shows
    this.want = null;         // a session picked by hand; null follows the newest activity
    this.at = null;           // the post the window was opened on: the thread starts at it
    this.posts = [];          // the shown session's posts, oldest first (drawn newest first)
    this.comments = [];       // the shown session's comments, oldest first
    this.details = {};        // post id -> { version, history, html } from /api/posts/:id
    this.rounds = {};         // post id -> the version being shown; absent is the latest
    this.loaded = { sessionId: null, lastActiveAt: null };  // what posts/comments were fetched at
    this.seen = null;         // session id -> lastActiveAt at the last good poll; null before the first
    this.fresh = {};          // session id -> changed since it was last looked at
    this.archived = [];       // archived session ids, from ARCHIVE_FILE
    this.held = false;        // stopped following the newest
    this.holdKey = null;      // the thread the hold was taken in
    this.jump = false;        // the session picker is open
    this.expand = false;      // the picker lists every session, not the first PICKER_ROWS
    this.old = false;         // the picker shows archived sessions
    this.images = {};         // ref -> { path, w, h } | { error } | { loading }
    this.editors = {};        // key -> EditorState
    this.runs = {};           // key -> { lines, styled }: a coloured terminal surface's text runs
    this.copied = null;       // the block whose text was just copied
    this.folded = {};         // block key -> open; a section is open until shut, a source shut until opened
    this.focus = null;        // the one section of one post the outline has isolated
    this.error = null;
    this.linkError = null;    // an address the window was opened on and could not read
    this.busy = false;
    this.width = 800;
    this.height = 0;
    this.placed = false;      // the place the app opened this window at has been checked against this app window
    this.keys = cx.focus_handle();
    this.start(cx);
  }

  // The app reopens a window where it last was: at the place it was dragged to, or at the spec a
  // restart kept. That place is in the app window's px from then, so after the app window has shrunk
  // the window is mostly outside it (task-132). When the place it opened at is off-view, close it and
  // open it at the fit readerWindow() computes; the app's own `keep` then remembers the fit.
  placeFit(cx) {
    if (this.placed) return;
    this.placed = true;
    const id = props()?.overlay;
    if (!id) return;
    const viewport = window.viewport_size();
    const key = props()?.pair ? PAIR_KEY : KEY;          // the pair half keeps its own remembered spot
    const fit = readerWindow(layout(), viewport, Number(settings().zoom ?? 1), MAX_WIDTH, props()?.pair ? "right" : null);
    cx.spawn(async (cx) => {
      let file = null;
      try { file = JSON.parse((await readTextFile(`${appHome()}/windows.json`)) ?? "null"); } catch (e) { return; }
      const place = rememberedPlace(file, key, String(shared("layout") ?? ""), fit);
      if (!place || insideWindow(place, viewport)) return;   // nothing remembered, or it fits: leave it
      // A dragged spot is always where the app put this window; a kept spec is, unless the app opened
      // the fit this mod asked for (the same size).
      if (!place.dragged && Math.abs(this.width - fit.width) <= 2 && Math.abs(this.height - fit.height) <= 2) return;
      const stamp = `${place.at.x},${place.at.y},${place.width},${place.height}`;
      if (replaced === stamp) return;   // this run already moved the window off that place
      replaced = stamp;
      closeOverlay(id);
      openOverlay({ mod: "sideshow", props: { window: true, url: props()?.url, pair: props()?.pair }, kind: "window", frame: "none", key, keep: true, ...fit });
    });
  }

  // The address that reopens this window where it is now: the post it is anchored at, else its session.
  here() {
    return this.at ? `/p/${this.at}` : this.shown ? `/session/${this.shown}` : undefined;
  }

  // ⤢ Pair / ⤢ Solo (task-161). Pairing opens Herdra at the pair's left half and reopens this window at
  // the right, both computed with the Spaces sidebar; solo closes Herdra and reopens this one at its own
  // remembered solo spot. The app cannot move an open window, so each side is closed and reopened.
  pairToggle() {
    const other = shared(OTHER), me = props().overlay;
    if (other) closeOverlay(other);
    closeOverlay(me);
    if (props()?.pair) {
      openOverlay({ mod: "sideshow", props: { window: true, url: this.here() }, kind: "window", frame: "none", key: KEY, keep: true, ...spot(null) });
      return;
    }
    openOverlay({ mod: "herdra", props: { window: true, openAt: Date.now(), pair: "left" }, kind: "window", frame: "none", key: "herdra-pair", keep: true, ...spot("left") });
    openOverlay({ mod: "sideshow", props: { window: true, url: this.here(), pair: "right" }, kind: "window", frame: "none", key: PAIR_KEY, keep: true, ...spot("right") });
  }

  // Read the origin and the archive file once, then poll the session list.
  start(cx) {
    cx.spawn(async (cx) => {
      try {
        const file = `${appHome()}/${ORIGIN_FILE}`;
        this.origin = ((await fs.exists(file)) ? (await fs.readFile(file, "utf8")).trim() : DEFAULT_ORIGIN).replace(/\/+$/, "");
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); return; }
      try { this.archived = await this.readArchive(); } catch (e) { console.error(`sideshow archive: ${e?.message ?? e}`); }
      await this.openLink(cx);
      this.poll(cx);
    });
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
  }

  api(path) {
    return fetch(this.origin + path).then((r) => r.ok ? r.json() : Promise.reject(new Error(`Sideshow ${r.status} for ${path}`)));
  }

  // `props().url` is where the app was asked to open this window. A post's session is asked of the
  // post itself, so a post reads where it is rather than where a link thought it was. Read once, at
  // open: picking a session or going back to the newest afterwards is the person's.
  async openLink(cx) {
    const link = linkOf(props()?.url);
    if (!link) return;
    try {
      const id = link.kind === "session" ? link.id : (await this.api(`/api/posts/${link.id}`)).sessionId;
      this.want = id;
      this.at = link.kind === "post" ? link.id : null;
    } catch (e) {
      // Not the newest session's problem: the window keeps following the newest, and says why this
      // did not open, for as long as it is open.
      this.linkError = `That link did not open: ${e?.message ?? e}`;
      console.error(`sideshow link ${props()?.url}: ${this.linkError}`);
    }
  }

  // ---- archive: one local file, one id per line, read on open and written on a click ----

  async readArchive() {
    const text = await readTextFile(`${appHome()}/${ARCHIVE_FILE}`);
    this.archiveText = text;   // what a write has to match, so a stale snapshot is refused
    return (text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  }

  // Archive the shown session: hide it here, leave Sideshow's own record alone.
  archive(cx) {
    const id = this.shown;
    if (!id) return;
    if (!this.archived.includes(id)) this.archived.push(id);
    this.jump = false; this.old = false;
    this.want = null;
    this.at = null;
    this.writeArchive();
    this.show(this.choose(this.sessions), cx);
    this.poll(cx);
    cx.notify();
  }

  restore(id, cx) {
    this.archived = this.archived.filter((a) => a !== id);
    this.writeArchive();
    this.poll(cx);
    cx.notify();
  }

  writeArchive() {
    const text = this.archived.length ? `${this.archived.join("\n")}\n` : "";
    const expected = this.archiveText ?? null;
    this.archiveText = text;
    writeTextFile(`${appHome()}/${ARCHIVE_FILE}`, text, expected).catch((e) => console.error(`sideshow archive: ${e?.message ?? e}`));
  }

  // ---- polling ----

  // The session list every 5s; the shown session's posts and comments only when its lastActiveAt
  // changed (or it was switched to). One request per poll while nothing happens.
  poll(cx) {
    // A hot reload can clear the toggle's note of this window (the old copy's close() runs last): restore it.
    const id = props()?.overlay;
    if (id && shared("sideshow.window") !== id) setShared("sideshow.window", id);
    if (!this.origin || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const sessions = await this.api("/api/sessions");
        sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
        if (this.seen) for (const s of sessions) {
          if (this.seen[s.id] !== s.lastActiveAt && s.id !== this.shown) this.fresh[s.id] = true;
        }
        this.sessions = sessions;
        const shown = this.choose(sessions);
        if (shown !== this.shown) this.show(shown, cx);   // switching session drops its retained state
        const session = sessions.find((s) => s.id === shown) ?? null;
        if (session && (this.loaded.sessionId !== shown || this.loaded.lastActiveAt !== session.lastActiveAt)) {
          const [posts, got] = await Promise.all([
            this.api(`/api/sessions/${shown}/posts`),
            this.api(`/api/comments?session=${shown}`),
          ]);
          if (this.shown !== shown) return;               // switched again while this was in flight
          this.posts = posts;
          this.comments = (got.comments ?? []).sort((a, b) => a.seq - b.seq);
          this.loaded = { sessionId: shown, lastActiveAt: session.lastActiveAt };
          for (const k of Object.keys(this.rounds)) if (!posts.some((p) => p.id === k)) delete this.rounds[k];
          await this.loadDetails(posts, cx);
          this.prepare(cx);
        }
        if (shown) delete this.fresh[shown];
        this.seen = Object.fromEntries(sessions.map((s) => [s.id, s.lastActiveAt]));
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      if (cx) cx.notify();
    });
  }

  // The hand-picked session while it still exists; else the newest activity that has posts and is
  // not archived. Posts are the only thing worth opening: an empty session shows nothing. A want the
  // window was opened on wins even when archived: a link to it names it.
  choose(sessions) {
    const has = (id) => sessions.some((s) => s.id === id);
    if (this.want && has(this.want)) return this.want;
    return sessions.find((s) => s.postCount > 0 && !this.archived.includes(s.id))?.id ?? null;
  }

  // Switching to another session (or away from one): the thread's retained state goes with it.
  show(id, cx) {
    const next = id ?? null;
    if (next === this.shown) return;
    for (const s of Object.values(this.editors)) s.release();
    this.editors = {};
    this.runs = {};
    this.copied = null;
    this.folded = {};
    this.focus = null;
    this.details = {};
    this.rounds = {};
    this.posts = [];
    this.comments = [];
    this.at = null;           // another session shows from its newest
    this.shown = next;
    this.loaded = { sessionId: null, lastActiveAt: null };   // the next poll fetches them
    this.held = false;
    this.holdKey = null;
    if (cx) this.prepare(cx);
  }

  // The detail (retained rounds, html bodies) of the posts that have either: fetched with the
  // session, never on a timer of its own.
  async loadDetails(posts, cx) {
    const url = (p) => this.api(`/api/posts/${p.id}`);
    const worth = posts.filter((p) => p.version > 1 || (p.surfaces ?? []).some((s) => s.kind === "html"));
    const got = await Promise.all(worth.map(async (p) => {
      try { return [p.id, await url(p)]; } catch (e) { return [p.id, null]; }
    }));
    const next = {};
    for (const [id, full] of got) {
      if (!full) continue;
      next[id] = {
        version: full.version,
        history: full.history ?? [],
        html: Object.fromEntries((full.surfaces ?? []).filter((s) => s.kind === "html").map((s) => [s.id, s.html])),
      };
    }
    this.details = next;
    if (cx) cx.notify();
  }

  // ---- the thread's retained state ----

  roundOf(p) { return this.rounds[p.id] ?? p.version; }

  shownSurfaces(p) {
    const round = this.roundOf(p);
    if (round === p.version) return p.surfaces ?? [];
    return this.details[p.id]?.history?.find((h) => h.version === round)?.surfaces ?? p.surfaces ?? [];
  }

  shownTitle(p) {
    const round = this.roundOf(p);
    if (round === p.version) return p.title;
    return this.details[p.id]?.history?.find((h) => h.version === round)?.title ?? p.title;
  }

  key(p, s) { return `${p.id}-${this.roundOf(p)}-${s.id}`; }

  postComments(id) { return this.comments.filter((c) => c.postId === id); }
  sessionComments() { return this.comments.filter((c) => !c.postId); }

  // Build the retained state for every part of every post in the thread, outside render.
  prepare(cx) {
    for (const s of Object.values(this.editors)) s.release();
    this.editors = {};
    this.runs = {};
    this.copied = null;
    const t = theme();
    for (const p of this.posts) for (const s of this.shownSurfaces(p)) {
      if (s.kind === "html" && s.html === undefined) s.html = this.details[p.id]?.html?.[s.id];
      const text = textOf(s), runs = s.kind === "terminal" ? ansiRuns(s.text ?? "") : null;
      if (runs?.styled) this.runs[this.key(p, s)] = runs;   // the editor cannot draw a coloured run
      else if (text) this.editors[this.key(p, s)] = EditorState.new({
        language: text.language, value: text.value, readonly: true, line_numbers: false, folding: false, soft_wrap: true,
        font_family: settings().font_family, font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
      if (s.kind === "image") this.fetchImage(`/a/${s.assetId}`, cx);
      if (s.kind === "markdown") for (const m of (s.markdown ?? "").matchAll(IMG)) this.fetchImage(m[2], cx);
    }
  }

  // Downloaded once (assets are content-addressed), so a file is never rewritten or re-decoded.
  fetchImage(ref, cx) {
    if (!cx || this.images[ref]) return;
    const url = ref.startsWith("/") ? this.origin + ref : ref;
    const rel = `${CACHE}/${ref.startsWith("/a/") ? ref.slice(3) : hash(ref)}`;
    const abs = `${appHome()}/${rel}`;
    this.images[ref] = { loading: true };
    cx.spawn(async (cx) => {
      try {
        await fs.mkdir(`${appHome()}/${CACHE}`, { recursive: true });
        if (!(await fs.exists(abs))) {
          const r = await exec("curl", ["-fsS", "--max-time", "20", "-o", `${abs}.part`, url]);
          if (r.code !== 0) throw new Error(r.stderr.trim() || `curl exit ${r.code}`);
          const mv = await exec("mv", [`${abs}.part`, abs]);
          if (mv.code !== 0) throw new Error(mv.stderr.trim());
        }
        const id = await exec("identify", ["-format", "%w %h", `${abs}[0]`]);
        const [w, h] = id.stdout.trim().split(" ").map(Number);
        if (!w || !h) throw new Error("not an image");
        this.images[ref] = { path: rel, w, h };
      } catch (e) { this.images[ref] = { error: String(e?.message ?? e) }; }
      cx.notify();
    });
  }

  openInBrowser(cx, path) { cx.open_url(this.origin + path); }

  // Where the browser opens this session: at its newest post, so a long thread starts at the end
  // rather than at the top. A session with no posts opens as a whole.
  browserPath() {
    const newest = this.posts[this.posts.length - 1];
    return newest ? `/session/${this.shown}/p/${newest.id}` : `/session/${this.shown}`;
  }

  // ---- following, holding, and the picker ----

  shownSession() { return this.sessions.find((s) => s.id === this.shown) ?? null; }

  // What the thread's scroll position is filed under: a new id starts it at the top, so following
  // the newest means a new id whenever the newest post, its version or the newest comment changed.
  newest() {
    const p = this.posts[this.posts.length - 1];
    const seq = this.comments[this.comments.length - 1]?.seq ?? 0;
    return `${p?.id ?? "none"}-${p?.version ?? 0}-${this.comments.length}-${seq}`;
  }

  bodyId() {
    if (!this.shown) return "ss-thread-none";
    const at = this.at ? `-at-${this.at}` : "";   // another post opened at is another place: from the top
    return `ss-thread-${this.shown}${at}-${this.held ? `hold-${this.holdKey ?? this.newest()}` : this.newest()}`;
  }

  hold(cx) { if (!this.held) { this.held = true; this.holdKey = this.newest(); } cx.notify(); }
  // Back to the newest: the whole thread, from the last post down, as the window shows it unasked.
  follow(cx) { this.held = false; this.holdKey = null; this.at = null; cx.notify(); }

  // Show a retained round of a post (or the latest one), rebuilding the thread's state for it.
  showRound(p, round, cx) {
    if (round === p.version) delete this.rounds[p.id]; else this.rounds[p.id] = round;
    this.focus = null;   // another round is another set of sections
    this.prepare(cx);
    cx.notify();
  }

  onKey(e, cx) {
    const k = e.keystroke;
    if (k === "up" || k === "home" || k === "k") this.hold(cx);
    else if (k === "end" || k === "j") this.follow(cx);
    else if (k === "escape" && this.jump) { this.jump = false; cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  // ---- parts ----

  contentWidth() { return this.width - 2 * PAD - 2; }
  // Prose keeps the window's width up to a generous cap: no reading column, nothing centred.
  proseWidth() { return Math.min(PROSE_MAX, this.contentWidth()); }

  // A card: theme chrome on the window's background, 1px border.
  card() {
    const t = theme();
    return v_flex().min_w_0().rounded(RADIUS).overflow_hidden().bg(t.chrome).border_1().border_color(t.border);
  }

  // A card's caption strip: what it is on the left, actions on the right.
  strip(label, ...right) {
    const t = theme();
    return h_flex().h(STRIP).flex_none().pl(10).pr(4).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(label))
      .children(right.filter(Boolean));
  }

  // A small text action, as in the header.
  action(id, label, onClick, accent) {
    const t = theme();
    return div().id(id).flex_none().px(6).py(2).rounded(5).text_size(11.5).text_color(accent ? t.accent : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click(onClick).child(label);
  }

  note(text) { return div().flex_none().text_size(11).text_color(theme().dim).child(text); }

  img(ref, alt, id, width) {
    const t = theme(), i = this.images[ref];
    const pending = (text, color) => div().h(64).flex().items_center().justify_center().text_size(12).text_color(color).child(text);
    if (!i || i.loading) return pending(alt ? `Loading ${alt}…` : "Loading image…", t.dim);
    if (i.error) return pending(`Image not shown: ${i.error}`, t.blocked);
    const w = Math.round(Math.min(i.w, width)), h = Math.round(i.h * (w / i.w));
    return image(i.path).id(id).w(w).h(h).rounded(6);
  }

  // An image in a card: the picture centred at min(natural, content width) with a small padding, its
  // caption under a rule in the same card.
  figure(ref, caption, id, width) {
    const t = theme();
    return this.card().w_full()
      .child(h_flex().w_full().justify_center().p(3).child(this.img(ref, caption, id, Math.max(1, width - 6))))
      .when(Boolean(caption), (el) => el.child(div().border_t(1).border_color(t.border).px(10).py(6)
        .text_size(11.5).text_color(t.muted).child(caption)));
  }

  // ---- a markdown surface: one document, in blocks ----

  // Every surface of a post, its markdown split into sections numbered across the whole post so
  // the outline and the fold keys agree. The first markdown surface drops the `# ` heading that
  // only repeats the post's own title.
  plan(p) {
    let base = 0, first = true;
    return this.shownSurfaces(p).map((s) => {
      if (s.kind !== "markdown") return { s, sections: null, base: 0 };
      const raw = s.markdown ?? "";
      const sections = splitSections(first ? raw.replace(/^(?:[ \t]*\n)*#[ \t][^\n]*(?:\n|$)/, "") : raw);
      const entry = { s, sections, base: base + 1 };
      base += sections.length - 1;
      first = false;
      return entry;
    });
  }

  // A markdown surface as one card: prose, callouts, folding sections and figures inside its chrome.
  markdown(p, plan) {
    const t = theme(), { s, sections, base } = plan, key = this.key(p, s);
    const out = this.bodyBlocks(sections[0].body, `${key}-p`);
    for (let i = 1; i < sections.length; i++) {
      const n = base + i - 1, fold = this.sectionKey(p, n), open = this.sectionOpen(p, n);
      out.push(v_flex().w_full().min_w_0().gap(BLOCK_GAP)
        .child(h_flex().id(`ss-sec-${fold}`).w_full().gap(7).items_start().cursor_pointer()
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => this.foldSection(fold, open, cx))
          .child(div().flex_none().mt(4).text_size(11).text_color(open ? t.muted : t.dim).child(open ? "▼" : "▶"))
          .child(div().flex_1().min_w_0().text_size(18.5).font_semibold().child(sections[i].title)))
        .when(open, (el) => el.children(this.bodyBlocks(sections[i].body, `${key}-s${n}`))));
    }
    return this.card().w_full().max_w(PROSE_MAX).px(14).py(12).gap(BLOCK_GAP).children(out);
  }

  // A run of prose as blocks: a callout as its box, plain prose as text with its images between.
  bodyBlocks(text, id) {
    const out = [];
    for (const [i, block] of blocksOf(text).entries()) {
      const blockId = `${id}-b${i}`;
      if (block.kind === "callout") { out.push(this.callout(block, blockId)); continue; }
      out.push(...this.proseBlocks(block.text, blockId));
    }
    return out;
  }

  proseBlocks(text, id) {
    const out = [], code = codeRanges(text);
    const inCode = (at) => code.some((r) => at >= r.start && at < r.end);
    let last = 0, n = 0;
    const add = (part) => { if (part.trim()) out.push(this.prose(`${id}-t${n++}`, part)); };
    for (const m of text.matchAll(IMG)) {
      if (inCode(m.index)) continue;   // a code example, not a picture
      add(text.slice(last, m.index));
      out.push(this.figure(m[2], m[1], `${id}-i${n++}`, this.proseWidth() - 28));  // the card's px(14) either side
      last = m.index + m[0].length;
    }
    add(text.slice(last));
    return out;
  }

  // Prose itself: TextView's own markdown, at the post's reading size.
  prose(id, text) {
    return TextView.markdown(id, text).w_full().min_w_0().selectable(true).text_size(13).line_height(1.6);
  }

  // A `> [!KIND]` box: chrome and a 1px border, the kind's colour down its left edge, a label above.
  callout(block, id) {
    const t = theme(), kind = block.label;
    const color = kind === "DECIDE" ? t.accent : kind === "NOTE" ? t.ansi3 : t.blocked;
    const body = kind === "DECIDE" ? this.decide(block.text, id) : (block.text.trim() ? [this.prose(`${id}-b`, block.text)] : []);
    return h_flex().w_full().min_w_0().items_stretch().rounded(RADIUS).overflow_hidden()
      .bg(t.chrome).border_1().border_color(t.border)
      .child(div().w(2).flex_none().self_stretch().bg(color))
      .child(v_flex().flex_1().min_w_0().px(14).py(12).gap(8)
        .child(div().text_size(10).font_semibold().text_color(color).child(kind))
        .children(body));
  }

  // The words of a Decide box: the question, then one row per option, the recommendation marked.
  decide(text, id) {
    const t = theme(), { question, items, rec, reason, tail } = decideOf(text), out = [];
    if (question) out.push(TextView.markdown(`${id}-q`, question).w_full().min_w_0().selectable(true)
      .text_size(14).line_height(1.6).font_semibold());
    for (const [i, item] of items.entries()) {
      const on = i === rec;
      out.push(h_flex().w_full().min_w_0().gap(9).items_start()
        .child(div().flex_none().mt(2).size(17).rounded(5).flex().items_center().justify_center().border_1()
          .bg(on ? t.accent : t.raised).border_color(on ? t.accent : t.input)
          .text_color(on ? t.background : t.foreground).text_size(10.5).child(item.rank))
        .when(Boolean(item.text), (el) => el.child(TextView.markdown(`${id}-o${i}`, item.text)
          .flex_1().min_w_0().selectable(true).text_size(14).line_height(1.6)))
        .when(on, (el) => el.child(div().flex_none().mt(3).px(4).rounded(4).border_1().border_color(t.accent)
          .text_size(10).text_color(t.accent).child("RECOMMENDED"))));
    }
    if (reason) out.push(div().w_full().min_w_0().text_size(12.5).text_color(t.dim).child(reason));   // why, under the options
    if (tail) out.push(TextView.markdown(`${id}-tail`, tail).w_full().min_w_0().selectable(true)   // a paragraph after the list
      .text_size(12.5).line_height(1.6).text_color(t.dim));
    return out;
  }

  // Fold state, in memory and scoped to the round on show, so a fold made on v1 stays with v1.
  foldedOpen(key, openByDefault) { return this.folded[key] ?? openByDefault; }
  roundScope(p) { return `${p.id}:${this.roundOf(p)}:`; }
  sectionKey(p, n) { return `${this.roundScope(p)}section:${n}`; }
  sourceKey(p, s) { return `${this.roundScope(p)}source:${s.id}`; }
  sectionOpen(p, n) {
    return this.focus?.startsWith(this.roundScope(p))
      ? this.focus === this.sectionKey(p, n)
      : this.foldedOpen(this.sectionKey(p, n), true);
  }
  foldSection(key, open, cx) { this.folded[key] = !open; this.focus = null; cx.notify(); }

  // One section at a time, from the outline; the same chip again opens them all.
  focusSection(p, n, cx) {
    const key = this.sectionKey(p, n);
    if (this.focus !== key) { this.focus = key; cx.notify(); return; }
    this.focus = null;
    const scope = this.roundScope(p);
    for (const k of Object.keys(this.folded)) if (k.startsWith(scope) && k.includes(":section:")) delete this.folded[k];
    cx.notify();
  }

  // A post's sections as one row of `${n} ${title}` chips under its head: the fold control.
  outline(p, sections) {
    const t = theme();
    return h_flex().w_full().min_w_0().flex_wrap().gap(12).text_size(11.5).text_color(t.dim)
      .children(sections.map((sec) => {
        const on = this.focus === this.sectionKey(p, sec.n);
        return div().id(`ss-o-${p.id}-${sec.n}`).flex_none().cursor_pointer().text_size(11.5)
          .text_color(on ? t.foreground : t.dim)
          .hover((st) => st.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => this.focusSection(p, sec.n, cx))
          .child(`${sec.n} ${clip(sec.title, 28)}`);
      }));
  }

  // A text surface: its source behind one row when it is a diagram's, else its code card.
  code(p, s, key) {
    const text = textOf(s), lines = text.value.split("\n").length;
    if (!isSource(s)) return this.codeCard(p, s, key, lines);
    const t = theme(), fold = this.sourceKey(p, s), open = this.foldedOpen(fold, false);
    return v_flex().w_full().min_w_0().gap(0)
      .child(h_flex().id(`ss-src-${key}`).w_full().gap(6).py(4).items_center().cursor_pointer().text_color(t.dim)
        .hover((st) => st.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.folded[fold] = !open; cx.notify(); })
        .child(div().text_size(11).text_color(t.dim).child(open ? "▼" : "▶"))
        .child(div().text_size(11.5).text_color(t.dim).child(`Source · ${plural(lines, "line")}`)))
      .when(open, (el) => el.child(this.codeCard(p, s, key, lines).mt(6)));
  }

  codeCard(p, s, key, lines) {
    const t = theme(), text = textOf(s);
    const copied = this.copied === key;
    const copy = this.action(`copy-${key}`, copied ? "Copied" : "Copy", (_e, cx) => {
      cx.write_to_clipboard(text.value); this.copied = key; cx.notify();
    });
    const open = s.kind === "mermaid" && this.action(`open-${key}`, "Diagram ↗", (_e, cx) => this.openInBrowser(cx, `/p/${p.id}`), true);
    return this.card()
      .child(this.strip(labelOf(s), this.note(plural(lines, "line")), copy, open))
      .child(div().h(Math.min(CODE_MAX, CODE_LINE * lines + 12)).px(4).py(6).bg(t.background).child(Editor.new(this.editors[key]).size_full()));
  }

  // A terminal surface whose text carries colour: the editor cannot draw a coloured run, so the runs
  // are drawn themselves, in the code font, on the same card. Long lines scroll sideways, as a
  // terminal's columns are what they are.
  runsCard(p, s, key, runs) {
    const t = theme(), lines = runs.lines.length, copied = this.copied === key;
    const copy = this.action(`copy-${key}`, copied ? "Copied" : "Copy", (_e, cx) => {
      cx.write_to_clipboard(textOf(s).value); this.copied = key; cx.notify();
    });
    return this.card()
      .child(this.strip(labelOf(s), this.note(plural(lines, "line")), copy))
      .child(div().h(Math.min(CODE_MAX, CODE_LINE * lines + 12)).px(4).py(6).bg(t.background).overflow_scrollbar()
        .child(v_flex().children(runs.lines.map((line) => this.runLine(line)))));
  }

  // One line of a coloured terminal surface: its runs side by side, each in its own colour and weight.
  runLine(line) {
    const t = theme(), mono = settings().font_family;
    return h_flex().flex_none().h(CODE_LINE).items_center()
      .children(line.map((r) => div().flex_none().font_family(mono).text_size(12).line_height("18px")
        .text_color(ink(r, t))
        .when(r.bold, (el) => el.font_weight(700))
        .when(r.dim, (el) => el.opacity(0.6))
        .child(r.text)));
  }

  // html: its words as a short preview; the whole card opens the post in the browser.
  html(p, s, key) {
    const t = theme(), words = htmlText(s.html);
    return this.card().id(`open-card-${key}`).cursor_pointer().hover((st) => st.border_color(t.input))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.openInBrowser(cx, `/p/${p.id}`))
      .child(this.strip(`${labelOf(s)} · drawn in the browser`, div().flex_none().px(6).text_size(11.5).text_color(t.accent).child("Open ↗")))
      .when(Boolean(words), (el) => el.child(div().px(12).py(10).bg(t.background).text_size(12).text_color(t.muted)
        .child(words.length > 320 ? `${words.slice(0, 320)}…` : words)));
  }

  // trace: its steps as a timeline.
  trace(s) {
    const t = theme(), steps = s.steps ?? [];
    return this.card()
      .child(this.strip(labelOf(s), this.note(plural(steps.length, "step"))))
      .child(v_flex().px(12).py(8).gap(6).bg(t.background).children(steps.map((st, i) => h_flex().gap(10).items_start()
        .child(div().mt(5).size(6).flex_none().rounded(3).bg(i === steps.length - 1 ? t.accent : t.dim))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center()
            .when(Boolean(st.kind), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(st.kind)))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(st.label)))
          .when(Boolean(st.detail), (el) => el.child(div().text_size(12).text_color(t.muted).child(st.detail)))))));
  }

  surface(p, entry) {
    const s = entry.s, key = this.key(p, s);
    if (s.kind === "markdown") return this.markdown(p, entry);
    if (s.kind === "image") return this.figure(`/a/${s.assetId}`, s.caption ?? s.alt, key, this.proseWidth());
    if (this.runs[key]) return this.runsCard(p, s, key, this.runs[key]);   // a coloured terminal surface
    if (this.editors[key]) return this.code(p, s, key);
    if (s.kind === "trace") return this.trace(s);
    if (s.kind === "html") return this.html(p, s, key);
    return this.card().child(this.strip(`${labelOf(s)} · drawn in the browser`,
      this.action(`open-${key}`, "Open ↗", (_e, cx) => this.openInBrowser(cx, `/p/${p.id}`), true)));
  }

  // ---- chrome ----

  // One row: what this is, which session, the thread's numbers, and what can be done to it.
  header() {
    const t = theme(), s = this.shownSession();
    const open = this.jump;
    const counts = this.counts();
    return h_flex().h(42).flex_none().pl(14).pr(6).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().size(7).flex_none().rounded(4).bg(s ? t.accent : t.dim))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Sideshow"))
      .child(h_flex().id("ss-pick").flex_1().min_w(0).h(26).px(7).gap(7).items_center().rounded(6).cursor_pointer()
        .bg(open ? t.selected : t.chrome).border_1().border_color(t.border)
        .hover((st) => st.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.jump = !this.jump; this.old = false; cx.notify(); })
        .when(Boolean(s), (el) => el.child(this.chip(projectOf(s.cwd))))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().child(s?.title ?? "No sessions"))
        .child(div().text_size(9).text_color(t.dim).child("▾")))
      .when(Boolean(counts), (el) => el.child(h_flex().min_w(0).flex_shrink(1).gap(6).items_center().pl(4)
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(counts))
        .when(!this.held, (el2) => el2.child(div().size(6).flex_none().rounded(3).bg(t.done)))))
      .when(this.held, (el) => el.child(this.action("ss-newest", "Newest ↑", (_e, cx) => this.follow(cx), true)))
      .when(Boolean(this.origin && s), (el) => el.child(this.action("ss-browser", "Browser ↗", (_e, cx) => this.openInBrowser(cx, this.browserPath()))))
      .when(Boolean(s), (el) => el.child(this.action("ss-archive", "Archive", (_e, cx) => this.archive(cx))))
      .child(this.action("ss-pair", props()?.pair ? "⤢ Solo" : "⤢ Pair", () => this.pairToggle()))
      .child(this.action("ss-close", "✕", () => closeOverlay(props().overlay)));
  }

  // The thread's own numbers, as one line: `3 posts · 2 updated · 4 rounds · 1 comment`.
  counts() {
    if (!this.shown) return "";
    const rounds = this.posts.reduce((sum, p) => sum + Math.max(0, p.version - 1), 0);
    const updated = this.posts.filter((p) => p.version > 1).length;
    return [plural(this.posts.length, "post"), ...(updated ? [`${updated} updated`] : []),
      ...(rounds ? [plural(rounds, "round")] : []),
      ...(this.comments.length ? [plural(this.comments.length, "comment")] : [])].join(" · ");
  }

  // The session picker, dropped under the header: every session by activity, then archived ones.
  picker() {
    const t = theme();
    const live = this.sessions.filter((s) => !this.archived.includes(s.id));
    const rows = [];
    const list = this.expand ? live : live.slice(0, PICKER_ROWS);
    for (const [i, s] of list.entries()) {
      const on = s.id === this.shown;
      rows.push(h_flex().id(`ss-s-${s.id}`).h(30).px(9).gap(9).items_center().rounded(6).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.want = s.id; this.jump = false; this.show(s.id, cx); this.poll(cx); })
        .child(div().w(18).flex_none().text_size(11).text_color(t.dim).child(String(i + 1)))
        .child(this.chip(projectOf(s.cwd)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).when(on, (el) => el.font_medium()).text_color(on ? t.foreground : t.muted).child(s.title ?? "Untitled"))
        .when(Boolean(this.fresh[s.id]), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.accent)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${s.postCount} · ${ago(s.lastActiveAt)}`)));
    }
    if (!this.expand && live.length > list.length) rows.push(h_flex().id("ss-more").h(26).px(9).items_center().rounded(6).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.expand = true; cx.notify(); })
      .child(div().text_size(11).text_color(t.dim).child(`${plural(live.length - list.length, "more session")} · show all`)));
    const extras = [];
    if (this.archived.length) {
      extras.push(h_flex().id("ss-archived").h(26).px(9).items_center().gap(6).rounded(6).cursor_pointer()
        .hover((st) => st.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.old = !this.old; cx.notify(); })
        .child(div().text_size(10.5).text_color(t.dim).child(`${this.old ? "▾" : "▸"} archived · ${this.archived.length}`)));
      if (this.old) for (const id of this.archived) {
        const s = this.sessions.find((x) => x.id === id);
        extras.push(h_flex().id(`ss-a-${id}`).h(30).px(9).gap(9).items_center().rounded(6)
          .child(div().w(18).flex_none())
          .when(Boolean(s), (el) => el.child(this.chip(projectOf(s.cwd))))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.dim).child(s?.title ?? id))
          .child(this.action(`ss-restore-${id}`, "Restore", (_e, cx) => this.restore(id, cx), true)));
      }
    }
    const host = /^https?:\/\/([^/:.]+)/.exec(this.origin ?? "")?.[1] ?? "Sideshow server";
    extras.push(div().h(24).px(9).flex().items_center().child(div().text_size(10.5).text_color(t.dim).child(`${host} · ${plural(this.sessions.length, "session")}`)));
    const height = Math.min(360, 31 * rows.length + 27 * extras.length + 10);
    // The scrollbar wraps its element, so the absolute spot goes on a plain outer box.
    return div().absolute().top(42 - 2).left(8).right(8).h(height)
      .rounded(RADIUS).overflow_hidden().bg(t.popover).border_1().border_color(t.border).shadow_lg()
      .child(v_flex().id("ss-picker").size_full().overflow_y_scrollbar().p(4).gap(1)
        .on_mouse_down("left", stop)
        .children(rows).children(extras));
  }

  // A post in the thread: its title block, its outline, its parts, its rounds, its comments.
  postView(p) {
    const t = theme(), round = this.roundOf(p), latest = p.version, pinned = round !== latest;
    const plan = this.plan(p), title = this.shownTitle(p);
    const meta = [ago(stamp(p)), pinned ? `v${round} of ${latest}` : `v${round}`].join(" · ");
    const sections = plan.flatMap((e) => (e.sections ?? []).slice(1).map((sec, i) => ({ n: e.base + i, title: sec.title })));
    const comments = this.postComments(p.id);
    const surfaces = plan.map((e) => this.surface(p, e));
    return v_flex().id(`ss-post-${p.id}`).w_full().min_w_0().gap(GAP)
      .child(v_flex().gap(3).px(2)
        .child(h_flex().gap(8).items_center()
          .child(this.chip(projectOf(this.shownSession()?.cwd)))
          .when(latest > 1, (el) => el.child(this.updated()))
          .child(div().flex_1())
          .when(pinned, (el) => el.child(this.action(`back-${p.id}`, "Back to latest", (_e, cx) => this.showRound(p, latest, cx), true))))
        .child(div().text_size(16).font_semibold().child(title))
        .child(div().text_size(11.5).text_color(t.dim).child(meta)))
      .when(sections.length > 0, (el) => el.child(this.outline(p, sections)))
      .children(surfaces)
      .when(latest > 1, (el) => el.child(this.roundsRow(p)))
      .when(comments.length > 0, (el) => el.child(this.commentThread(p, comments)));
  }

  // The rounds of a post: every retained version, the shown one filled.
  roundsRow(p) {
    const t = theme(), cur = this.roundOf(p), first = Math.max(1, p.version - ROUNDS + 1);
    const all = [];
    for (let v = first; v <= p.version; v++) all.push(v);
    const chips = all.length <= ROUND_CHIPS
      ? all
      : [all[0], ...all.slice(-(ROUND_CHIPS - 2))];
    const folded = all.length > ROUND_CHIPS;
    const items = [];
    chips.forEach((v, i) => {
      if (folded && i === 1) items.push(div().flex_none().text_size(11).text_color(t.dim).child("…"));
      items.push(this.roundChip(p, v, v === cur));
    });
    const note = cur === p.version ? "" : ago(this.details[p.id]?.history?.find((h) => h.version === cur)?.at ?? p.updatedAt);
    return h_flex().gap(5).items_center().px(2)
      .child(div().flex_none().text_size(11).text_color(t.dim).child("rounds"))
      .children(items)
      .when(Boolean(note), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`· from ${note} ago`)));
  }

  roundChip(p, v, on) {
    const t = theme();
    return div().id(`ss-v-${p.id}-${v}`).flex_none().px(6).py(1).rounded(5).text_size(11).cursor_pointer()
      .bg(on ? t.selected : t.chrome).border_1().border_color(on ? t.input : t.border).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.showRound(p, v, cx)).child(`v${v}`);
  }

  // The comments of a post, oldest first, behind a rail: yours in accent, the agent's in muted.
  commentThread(p, comments) {
    const t = theme();
    return v_flex().ml(3).pl(11).border_l(2).border_color(t.raised).gap(7)
      .children(comments.map((c) => v_flex().gap(1)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().text_size(11).text_color(c.author === "user" ? t.accent : t.muted).child(c.author === "user" ? "you" : c.author))
          .when(Boolean(c.anchor), (el) => el.child(div().flex_none().px(4).rounded(4).border_1().border_color(t.border)
            .text_size(10.5).text_color(t.muted).child(`on ${this.anchorLabel(p, c.anchor)}`)))
          .child(div().flex_1())
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(c.createdAt))))
        .child(div().text_size(12).child(c.text))));
  }

  anchorLabel(p, anchor) {
    const kind = anchor?.surfaceKind ?? p.surfaces?.[anchor?.surfaceIndex]?.kind ?? "surface";
    return kind;
  }

  // Session-level comments (no post) sit above the thread's posts.
  sessionNotes() {
    const t = theme(), notes = this.sessionComments();
    if (!notes.length) return null;
    return v_flex().ml(3).pl(11).border_l(2).border_color(t.raised).gap(7)
      .children(notes.map((c) => v_flex().gap(1)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().text_size(11).text_color(c.author === "user" ? t.accent : t.muted).child(c.author === "user" ? "you" : c.author))
          .child(div().flex_1())
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(c.createdAt))))
        .child(div().text_size(12).child(c.text))));
  }

  // The project's chip, as in the mockup: a pill in the project's colour.
  chip(project) {
    const t = theme();
    return div().flex_none().px(7).rounded(9).text_size(11).font_semibold().bg(chipColor(project)).text_color(t.background).child(project);
  }

  // Marks a post that was edited after it was first published.
  updated() {
    const t = theme();
    return div().flex_none().px(5).rounded(4).border_1().border_color(t.input).text_size(10.5).text_color(t.accent).child("updated");
  }

  // The tab-bar button, drawn like the shipped tab bar's Files/Changes buttons; lit while the window is open.
  panelButton() {
    const t = theme(), on = Boolean(shared("sideshow.window"));
    return h_flex().id("root").size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("ss-panel-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click(() => toggle())
        .when(Boolean(this.icon), (el) => el.child(svg(this.icon).size(14)))
        .child("Sideshow"));
  }

  render(cx) {
    if (this.role === "toggle") return div();
    if (this.role === "button") return this.panelButton();
    const t = theme();
    const loading = Boolean(this.shown) && this.loaded.sessionId !== this.shown;
    const notes = this.sessionNotes();
    // Opened on a post: the thread starts there, the posts above it out of the way but counted. A
    // plain scroll area starts at the top and cannot be moved, so this is how a post comes into view.
    const from = this.at ? this.posts.findIndex((p) => p.id === this.at) : -1;
    const newer = from > 0 ? this.posts.slice(from + 1) : [];
    const posts = from > 0 ? this.posts.slice(0, from + 1) : this.posts;
    const body = v_flex().id(this.bodyId())
     .flex_1().min_h(0).w_full().overflow_y_scrollbar().px(PAD).py(PAD - 2).gap(GAP + 2)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.keys.focus(); if (this.jump) { this.jump = false; cx.notify(); } })
      .when(Boolean(this.error || this.linkError), (el) => el.child(this.card().px(12).py(10).text_color(t.blocked).child(this.error ?? this.linkError)))
      .when(Boolean(notes), (el) => el.child(notes))
      .when(!this.shown && !this.error, (el) => el.child(this.card().px(12).py(10).text_color(t.dim).child(this.seen ? "No sessions with posts" : "Loading…")))
      .when(Boolean(this.shown), (el) => el.child(h_flex().gap(8).items_center()
        .child(div().text_size(11.5).text_color(t.dim)
          .child(loading ? "Loading…" : !this.posts.length ? "No posts in this session yet"
            : this.held ? "held" : newer.length ? `opened at a post · ${plural(newer.length, "newer post")}` : "following the newest"))
        .when(newer.length > 0, (el2) => el2.child(this.action("ss-all", "Back to newest", (_e, cx) => this.follow(cx), true)))))
      .children([...posts].reverse().map((p) => this.postView(p)));
    // A card like the shipped Files panel and the pane cards: theme background, 1px border, radius 10.
    return v_flex().id("root").relative().size_full().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .track_focus(this.keys).on_key_down((e, cx) => this.onKey(e, cx))
      .on_size_change((size, cx) => { this.width = size.width; this.height = size.height; this.placeFit(cx); cx.notify(); })
      .child(this.header())
      .child(body)
      .when(this.jump, (el) => el.child(this.picker()));
  }

  async close() {
    if (this.role === "toggle" || this.role === "button") return;
    for (const s of Object.values(this.editors)) s.release();
    this.keys?.release();
    if (shared("sideshow.window") === props()?.overlay) setShared("sideshow.window", null);
  }
}
