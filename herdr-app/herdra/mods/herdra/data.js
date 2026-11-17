// What Algorant should see (task-57): Herdra's own list, read from herdra-open and nothing else.
//   herdra-open list --json --closed 24h   the one source of Herdra's reply footer and this window:
//                                          Needs you / In progress / Up next (open items by `section`) and
//                                          Done (closed in the last 24h, the close note is the outcome);
//                                          an In progress item whose agent went idle while it still owes
//                                          it carries `silent` {status, at, age, mark} (bin/herdra-silent),
//                                          the mark the footer prints
// hc and the boards only decorate an item, they never add one:
//   hc ls --json, hc machine ls --json   an item's agent (working pill and time, blocked) and the fleet strip
//   whois --json <ids>                   every name shown for an agent (task-82): ids batched, asked only when new or relabelled
//   tandem list --no-sync --json         each running Ceph's board, one call: a linked Task's state, and the
//                                        validation/delivered Tasks no open item links to ("On boards, not
//                                        raised"); the states and accord statuses are filtered here, and
//                                        nothing is synced (no fetch, push or ref work)
//   tandem show <id> --json              a board Task's or a task link's summary and Sideshow link (on demand)
//   herdra-online --list --json          Pending's machine-gated Tasks (tagged needs-<host> on their boards)
//   inbox thread <id> --json             a thread link's conversation (on demand)
// The list and the inbox live on OWNER (workstation, where Herdra runs). On any other machine they are read
// there through `hc exec --on OWNER`, as the Usage mod reads its records; nothing is copied or synced.
// The items then name terminals as OWNER sees them (`t27`, `laptop/t3`), so their links are turned into this
// machine's addresses (`desktop/t27`, `t3`) before anything is matched against hc ls here.
// No registry of its own. Two reads, kept in the shared snapshot "herdra.snapshot": part `fast` when
// the list changes (and once a minute on a machine that does not hold it), part `board` while Herdra's
// window is open. The button is their one reader; the window draws from that snapshot at once and
// nothing here is on its open path.
import { exec, hc, home, notify, shared, setShared, terminals } from "herdr";

const OWNER = "desktop";   // the host that runs Herdra and holds herdra-open's list
const WHOIS = () => `${home()}/.pi/agent/scripts/whois`;
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "nu", "pwsh"]);
const SIDESHOW_LINK = /https?:\/\/[A-Za-z0-9.\-\[\]:]*:8228\/(?:session|p)\/[A-Za-z0-9_-]+/g;

async function json(cmd, args, opts) {
  const r = cmd === "hc" ? await hc(args) : await exec(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${[cmd, ...args].join(" ")}: ${(r.stderr || r.stdout).trim().split("\n").pop() || `exit ${r.code}`}`);
  return JSON.parse(r.stdout);
}

// This machine's name, and where OWNER's programs are: on OWNER itself nothing is remote (`on: null`).
let where;
async function locate() {
  if (where) return where;
  const r = await hc(["server", "status", "--json"]);
  if (r.code !== 0) throw new Error("hc server status failed");
  const self = JSON.parse(r.stdout)?.core?.name;
  if (typeof self !== "string" || !self) throw new Error("this machine's name is unknown");
  if (self === OWNER) return (where = { self, on: null, home: home() });
  const h = await exec("printenv", ["HOME"], { on: OWNER });
  const dir = h.stdout.trim();
  if (h.code !== 0 || !dir) throw new Error(`${OWNER}: home unknown`);
  return (where = { self, on: OWNER, home: dir });
}

// Runs one of OWNER's scripts, where it lives; JSON out.
async function onOwner(script, args) {
  const w = await locate();
  return json(`${w.home}/${script}`, args, { on: w.on });
}

// Whether this machine holds herdra-open's list itself (Herdra's, on OWNER), rather than reading OWNER's.
export const ownsList = async () => (await locate()).on === null;

// An address as OWNER writes it, as this machine writes it (and back).
const here = (addr, self) => {
  if (self === OWNER) return addr;
  const m = machineOf(addr);
  return m === self ? addr.slice(m.length + 1) : m ? addr : `${OWNER}/${addr}`;
};

export const dur = (iso) => {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.floor(m / 1440)}d`;
};

export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const space = (t) => (t?.where ?? "").split(" / ")[0] || null;
const tab = (t) => (t?.where ?? "").split(" / ").slice(1).join(" / ") || null;
const machineOf = (addr) => (addr.includes("/") ? addr.split("/")[0] : null);

// hc's view of every machine: live terminals (addresses `t7` here, `homelab-server/t3` there) and machines.
const fleetOf = (ls, ms, self) => ({ terms: (ls.terminals ?? []).filter((t) => t.state === "live"), machines: ms.machines ?? [], self });
async function fleet() {
  const [ls, ms] = await Promise.all([json("hc", ["ls", "--json"]), json("hc", ["machine", "ls", "--json"])]);
  return fleetOf(ls, ms);
}

// Herdra's own terminal: the hc terminal named herdra, on OWNER (this machine when it is OWNER).
const herdraOf = (f) => f.terms.find((t) => t.name === "herdra" && machineOf(t.address) === (f.self === OWNER ? null : OWNER)) ?? null;

const cephLike = (t) => tab(t) === "main" && !SHELLS.has(t.agent) && !t.parent;

// Every name on screen comes from `whois` (the one resolver, task-585); it exits 1 when an id names
// nothing and still prints its JSON. Its answers are kept in shared `herdra.who`, keyed by the id asked,
// so it is asked only for an id that is new or whose hc label changed: an id that names nothing stays
// cached as failed instead of being resolved again on every read. `who` maps each asked id, and the id
// it resolved to, to {label, id}.
const WHO = "herdra.who";
const hcLabel = (id) => terminals().find((t) => t.address === id || t.name === id)?.labels?.label ?? null;
async function whoisOf(ids) {
  const asked = [...new Set(ids)];
  if (!asked.length) return {};
  const known = shared(WHO) ?? {};
  const now = Object.fromEntries(asked.map((id) => [id, hcLabel(id)]));
  const need = asked.filter((id) => known[id]?.hcLabel !== now[id]);
  const fresh = {};
  if (need.length) {
    const r = await exec(WHOIS(), ["--json", ...need]);
    if (!r.stdout.trim()) throw new Error(`whois: ${(r.stderr || `exit ${r.code}`).trim().split("\n").pop()}`);
    JSON.parse(r.stdout).forEach((w, i) => {
      fresh[need[i]] = w.error ? { label: need[i], id: need[i], hcLabel: now[need[i]], failed: true } : { label: w.label, id: w.id, hcLabel: now[need[i]] };
    });
  }
  const cache = {};
  for (const id of asked) cache[id] = fresh[id] ?? known[id];
  put(WHO, cache);
  const who = {};
  for (const id of asked) if (!cache[id].failed) who[id] = who[cache[id].id] = { label: cache[id].label, id: cache[id].id };
  return who;
}

// A name as the window shows it: whois's label, `@machine` after a peer's.
// `@machine` only when the label does not already say the machine ("homelab-server Ceph" stays as is).
const named = (label, address) => (machineOf(address) && !norm(label).startsWith(norm(machineOf(address))) ? `${label}@${machineOf(address)}` : label);
const agentOf = (t, who) => (t ? { address: t.address, name: named(who[t.address]?.label ?? t.address, t.address), status: t.status, where: t.where ?? null } : null);

// What an item's `on` asks whois: a name (on the machine after an `@`: `machine/name`); null for
// Algorant, Herdra, or a machine that is not connected.
function onOf(o, f) {
  const [name = "", asked] = String(o.on ?? "").split("@");
  if (["", "algorant", "herdra"].includes(name.toLowerCase())) return null;
  // As OWNER wrote it: no `@` is OWNER's own machine, `@` another's (this one, from here, is local).
  const at = asked ?? (f.self && f.self !== OWNER ? OWNER : null);
  const machine = at && norm(at) !== norm(f.self ?? OWNER) ? f.machines.find((m) => norm(m.name) === norm(at))?.name : null;
  if (at && norm(at) !== norm(f.self ?? OWNER) && !machine) return null;
  return { name, machine, id: machine ? `${machine}/${name}` : name };
}

// Every id the fast read needs named: each Ceph's terminal, Herdra's, each item's agent.
const whoIds = (f, open) => [
  ...f.terms.filter((t) => cephLike(t) || t === herdraOf(f)).map((t) => t.address),
  ...open.flatMap((o) => (o.links ?? []).filter((l) => l.kind === "agent").map((l) => l.target).concat(onOf(o, f)?.id ?? [])),
];

// The live terminal an item is on: its `agent=` link, else the terminal whois finds for its `on`, else
// (a project's name) that project's Ceph. null: Algorant, Herdra, or nothing live.
function terminalOfItem(o, f, who) {
  const link = (o.links ?? []).find((l) => l.kind === "agent");
  if (link) return f.terms.find((t) => t.address === link.target) ?? null;
  const on = onOf(o, f);
  if (!on) return null;
  const found = who[on.id] && f.terms.find((t) => t.address === who[on.id].id);
  return found ?? f.terms.find((t) => cephLike(t) && machineOf(t.address) === on.machine && norm(space(t)) === norm(on.name)) ?? null;
}

// ---- the snapshot: two parts, each rebuilt from raw reads by a pure builder ----

export const SNAPSHOT = "herdra.snapshot";
// A part written by an older layout of this mod (another `shape`) is not read: it is read again.
// 5: board rows carry no summary or Sideshow link (those are a `tandem show` on expand).
// 6: an item carries `silent` (the idle mark, task-117).
const SHAPE = 6;
export const snapshot = () => {
  const s = shared(SNAPSHOT) ?? {};
  return { fast: s.fast?.shape === SHAPE ? s.fast : undefined, board: s.board?.shape === SHAPE ? s.board : undefined };
};

// Writes one part only when it changed: setShared redraws every mod and saves shared.json.
function commit(part, value) {
  const cur = snapshot();
  if (JSON.stringify(cur[part]) === JSON.stringify(value)) return;
  setShared(SNAPSHOT, { ...cur, [part]: value });
}

// Writes another shared value under the same rule.
const put = (key, value) => {
  if (JSON.stringify(shared(key) ?? null) === JSON.stringify(value)) return;
  setShared(key, value);
};

const newest = (a, b) => (b.at ?? "").localeCompare(a.at ?? "");

// A link's target as the window needs it: a task link is `Project:task-id`.
function linkOf(l, f, who) {
  if (l.kind === "task") {
    const i = l.target.lastIndexOf(":");
    return { ...l, project: i > 0 ? l.target.slice(0, i) : null, id: l.target.slice(i + 1) };
  }
  if (l.kind === "agent") return { ...l, agent: agentOf(f.terms.find((t) => t.address === l.target), who) };
  return l;
}

// What each part of the fast read holds. `raw` is the output of readFast(); `since` the previous
// snapshot's first-seen-working map (hc ls has no start time, so a turn's age is counted from when
// a poll first saw the agent working).
export function buildFast(raw, since = {}, now = Date.now()) {
  const f = fleetOf(raw.ls, raw.ms, raw.self);
  const herdra = herdraOf(f);

  const nowSince = {};
  for (const t of f.terms.filter((t) => t.status === "working")) nowSince[t.address] = since[t.address] ?? new Date(now).toISOString();

  const item = (o) => {
    const t = terminalOfItem(o, f, raw.who);
    return {
      key: o.id, id: o.id, section: o.section, project: o.project, headline: o.closed ? o.closed.note || o.what : o.what, what: o.what,
      kind: o.kind ?? null, ask: o.ask ?? null, options: o.options ?? [], rec: o.rec ?? null,
      links: (o.links ?? []).map((l) => linkOf(l, f, raw.who)),
      on: o.on ?? null, waiting: o.waiting ?? null, closes: o.closes ?? null,
      at: o.at, closedAt: o.closed?.at ?? null, note: o.closed?.note ?? null,
      history: (o.history ?? []).map((h) => ({ op: h.op, at: h.at, ...(h.op === "update" ? { fields: Object.keys(h).filter((k) => !["op", "id", "at"].includes(k)), on: h.on ?? null, parked: h.parked ?? null } : h.op === "open" ? { on: h.on } : { note: h.note ?? "" }) })),
      agent: agentOf(t, raw.who), since: t && nowSince[t.address] ? nowSince[t.address] : null,
      silent: o.silent ?? null,
      go: t ? { terminal: t.address } : null,
    };
  };
  const items = raw.open.map(item);
  const of = (s) => items.filter((i) => i.section === s);

  // Each Ceph's dot, Herdra included, one per project.
  const cephs = f.terms.filter((t) => cephLike(t) || (herdra && t.address === herdra.address));
  const strip = [];
  for (const t of cephs) {
    const label = named(raw.who[t.address]?.label ?? t.address, t.address);
    if (!strip.some((s) => s.name === label)) strip.push({ name: label, status: t.status, address: t.address });
  }

  return {
    herdra: herdra?.address ?? null,
    offline: f.machines.filter((m) => m.state !== "connected").map((m) => m.name),
    fleet: strip,
    you: of("you"), progress: of("progress"), next: of("next"), pending: of("pending"), done: of("done"),
    since: nowSince, shape: SHAPE,
  };
}

export async function readFast() {
  const [ls, ms, items] = await Promise.all([
    json("hc", ["ls", "--json"]), json("hc", ["machine", "ls", "--json"]),
    onOwner("Projects/herdra/bin/herdra-open", ["list", "--json", "--closed", "24h"]),
  ]);
  const { self } = await locate();
  const open = items.map((o) => ({ ...o, links: (o.links ?? []).map((l) => (l.kind === "agent" ? { ...l, target: here(l.target, self) } : l)) }));
  return { ls, ms, open, self, who: await whoisOf(whoIds(fleetOf(ls, ms, self), open)) };
}

// The board of every running Ceph (the agent in a space's `main` tab, local or on another machine):
// one `tandem list --no-sync --json` per board, all boards in parallel, filtered here — its delivered
// Tasks and its Tasks in state validation (the explicit `tandem review` escalation: left for Algorant).
// `--no-sync` reads the board's local files only and syncs nothing (no fetch, push or ref work), so a
// refresh is one process per board, plus tandem's own `git rev-parse` to find the workspace; a board
// another client has not refreshed yet reads as that client left it. A machine whose tandem
// predates 0.17.6 (laptop until its next reconnect, tandem task-105) does not know the flag, so its
// boards are not listed until it updates: no second path for it. A row's summary and Sideshow link
// come from `tandem show` only when the row is expanded (taskText), never on a refresh.
//
// `gated` also reads herdra-online's list of the Tasks tagged needs-<host>, which only changes when a
// machine comes or goes: a boards-only read reuses the last gated list kept in shared `herdra.gated`,
// so buildBoard still fills Pending.
export async function readBoard(gated = true) {
  const [boards, list] = await Promise.all([readBoards(), gated ? gatedList() : shared(GATED) ?? []]);
  if (gated) put(GATED, list);
  return { boards, gated: list };
}

// herdra-online's machine-gated Tasks (it exits 1 when one board is unreadable and still lists the rest).
const GATED = "herdra.gated";
async function gatedList() {
  const w = await locate();
  const r = await exec(`${w.home}/Projects/herdra/bin/herdra-online`, ["--list", "--json"], { on: w.on });
  if (!r.stdout.trim()) throw new Error(`herdra-online --list: ${(r.stderr || `exit ${r.code}`).trim().split("\n").pop()}`);
  return JSON.parse(r.stdout);
}

async function readBoards() {
  const f = await fleet();
  const seen = new Set(), ceph = [];
  for (const t of f.terms) {
    if (!cephLike(t) || !t.cwd) continue;
    const id = `${machineOf(t.address) ?? ""}:${t.cwd}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ceph.push(t);
  }
  return Promise.all(ceph.map(async (t) => {
    const opts = { cwd: t.cwd, on: machineOf(t.address) };
    try {
      const board = (await json("tandem", ["list", "--no-sync", "--json"], opts)).data ?? [];
      return { ceph: t, delivered: board.filter((r) => r.accordStatus === "delivered"), review: board.filter((r) => r.state === "validation") };
    } catch { return null; }   // no board there, or a tandem too old to read one without syncing it
  }));
}

// Tasks on the boards that Algorant or an owner is waiting on: `state` is "validation" (left for
// Algorant) or "delivered" (awaiting its owner). The window joins them to the open items by project
// and id: a linked one decorates its row, an unlinked one is "On boards, not raised".
export function buildBoard({ boards, gated }) {
  const seen = new Set(), tasks = [];
  for (const b of boards.filter(Boolean)) {
    const project = space(b.ceph), onReview = new Set(b.review.map((r) => r.id));
    const first = (id) => !seen.has(`${project}:${id}`) && seen.add(`${project}:${id}`);   // the same board seen from two machines
    for (const r of b.review) {
      if (!first(r.id)) continue;
      tasks.push({
        key: `task-${project}-${r.id}`, project, id: r.id, title: r.title, state: "validation", headline: `${r.id} ${r.title}`,
        at: r.updatedAt ?? null, atLabel: "updated",
        meta: [project, r.parentId ? `subtask of ${r.parentId}` : null].filter(Boolean),
        go: { terminal: b.ceph.address },
      });
    }
    for (const r of b.delivered) {
      if (onReview.has(r.id) || !first(r.id)) continue;
      tasks.push({
        key: `task-${project}-${r.id}`, project, id: r.id, title: r.title, state: "delivered", headline: `${r.id} ${r.title}`, at: null,
        meta: [project, "delivered, awaiting its owner"],
        go: { terminal: b.ceph.address },
      });
    }
  }
  // Machine-gated Tasks, shown under Pending; `owner` is who herdra-online tells (a Ceph, or herdra).
  const pending = gated.map((g) => ({
    key: `gated-${g.host}-${g.project}-${g.id}`, project: g.project, id: g.id, title: g.title, state: "pending", headline: `${g.id} ${g.title}`, at: null,
    meta: [g.project, `needs ${g.host}`, g.connected ? `${g.host} online, owner told` : `${g.host} away`],
    go: null,
  }));
  return { tasks: tasks.sort(newest), pending, shape: SHAPE };
}

export async function refreshFast() {
  const raw = await readFast();
  commit("fast", buildFast(raw, snapshot().fast?.since));
  const back = reconnected(raw.ms, raw.self);   // returned: the button reads the boards for these
  for (const m of back) await announce(m);
  return back;
}

// ---- machine-gated work (task-94) ----

// The machines hc was connected to at the last read, kept in shared state so that it survives app
// restarts and every copy of this mod sees one edge: the first copy to read the change takes it
// (a synchronous read-and-write, so a second copy sees no change). Only OWNER's copy acts.
const MACHINES = "herdra.machines";
function reconnected(ms, self) {
  if (self !== OWNER) return [];
  const prev = shared(MACHINES), now = Object.fromEntries((ms.machines ?? []).map((m) => [m.name, m.state === "connected"]));
  if (JSON.stringify(prev) === JSON.stringify(now)) return [];
  setShared(MACHINES, now);
  return prev ? Object.keys(now).filter((m) => now[m] && !prev[m]) : [];
}

// hc is connected to `machine` again: herdra-online tells each owner its Tasks tagged needs-<machine>
// (bin/herdra-online). It runs in an hc terminal so it can send; a failure raises a notice.
async function announce(machine) {
  const dir = `${home()}/Projects/herdra`;
  const r = await hc(["run", "--rm", "--no-parent", "--json", "--cwd", dir, "--label", `herdra-online=${machine}`, `${dir}/bin/herdra-online`, machine]);
  const wait = r.code === 0 ? JSON.parse(r.stdout)?.wait : null;
  if (wait && (!wait.ended || wait.exit_code === 0)) return;   // done, or still running after hc's wait
  notify({ level: "error", title: `herdra-online ${machine} failed`, body: wait ? "see ~/.local/state/herdra/online.log" : (r.stderr || r.stdout).trim() });
}

export async function refreshBoard(gated) {
  commit("board", buildBoard(await readBoard(gated)));
}

// ---- on demand, for a link in the detail view ----

// A message's conversation, as markdown.
export async function threadText(id) {
  const msgs = await onOwner(".pi/agent/scripts/inbox", ["thread", id, "--json"]);
  return msgs.map((m) => `**${m.from.label ?? m.from.terminal} → ${m.to.label ?? m.to.terminal}** · ${m.kind} · ${ago(m.at)}${m.id === id ? " · *this one*" : ""}\n\n${m.body ?? m.headline}`).join("\n\n---\n\n");
}

// A Task's record from its project's Ceph board: its summary and evidence as markdown, and the
// Sideshow link in it, if any.
export async function taskText(project, id) {
  const f = await fleet();
  const t = f.terms.find((x) => cephLike(x) && x.cwd && norm(space(x)) === norm(project));
  if (!t) throw new Error(`no running Ceph for ${project}`);
  const d = (await json("tandem", ["show", id, "--json"], { cwd: t.cwd, on: machineOf(t.address) })).data;
  const a = d.accord ?? {};
  const evidence = (a.evidence ?? []).map((e) => `- ${e}`).join("\n");
  const text = [`**${d.id} ${d.title}** · ${d.state}${a.status ? ` · ${a.status}` : ""}`, a.summary, evidence && `Evidence:\n\n${evidence}`].filter(Boolean).join("\n\n");
  return { text, post: (text.match(SIDESHOW_LINK) ?? []).pop() ?? null };
}
