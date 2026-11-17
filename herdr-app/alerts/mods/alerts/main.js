// Alerts: Herdr's desktop notifications in Hokum, Algorant's notification daemon. A 0px listener
// block in main-sideshow; it draws nothing. Two sources, one card per thing:
//
// The Needs-you desk (task-64, direction B): every open herdra-open item on Algorant (section "you",
// the footer's Needs you) is one card, Hokum's default timeout (~6 s; Algorant: nothing sticky unless he asks):
//   app "<Kind> · <Project>", title <what>, body <rec>      [Open <kind>] [Jump to Herdra]
//   closed                       -> the same card becomes app "Done · <Project>", title <close note>, body <what>, default timeout
//   moved off him (not closed)   -> the card closes
// Hokum draws it (stripe in the kind's colour, KIND · PROJECT label, the recommendation in a box) with the
// rules in hokum-cards.kdl; without them it is a plain card with the same texts (task-79).
// Read with `herdra-open list --json --closed 24h` (the footer's and Herdra window's source) on local
// open.jsonl changes; on another machine, read the items the herdra mod keeps in Herdr's shared
// snapshot "herdra.snapshot" (its `fast` part) and refresh them every 2 seconds, spawning nothing.
//
// The mirror (task-59, direction A): Herdr's own agent alerts, once per change, one card per agent:
//   blocked, and the agent's tab isn't the shown one (or the window isn't active)  ->  "<whois label> needs you"
//   done (agents() already means "finished while you weren't looking")             ->  "<whois label> finished"
// Only what's for Algorant (task-108, option C; why: RECIPE.md "Why notifications are filtered"):
//   done after a turn an agent started (Pi label pi.turn=agent: inbox reports, Herdra digesting them)  ->  no card
//   done after his own prompt (pi.turn=person)  ->  body = what the agent said (label pi.say)
//   blocked                                     ->  body = the question it waits on (OSC 7501 msg)
//   no such label or text (other agents, Pis before .pi's task-640)  ->  body "<program> · <space> › <tab>"
// A new alert for an agent replaces its card, and so does its text arriving after the alert; when the
// agent leaves blocked/done or disappears, the card closes. Hokum's own timeout. Click runs herdr-jump.
//
// All cards are normal urgency: never through Do Not Disturb.
//
// Herdr's in-app toast for the same agent alerts is hidden by the toast mod in herdr-app/toast (task-76);
// init keeps that copy installed.
import { View, div } from "gpui-kit";
import { agents, terminals, focused, window, appHome, home, exec, machines, shared, watchFolder } from "herdr";

const BUS = ["--user", "--", "call", "org.freedesktop.Notifications", "/org/freedesktop/Notifications", "org.freedesktop.Notifications"];
const STATE = `${home()}/.local/state/herdra`;
const LOG = `${STATE}/open.jsonl`;
const HERDRA_OPEN = `${home()}/Projects/herdra/bin/herdra-open`;
const WHOIS = `${home()}/.pi/agent/scripts/whois`;
const TOAST_INSTALL = `${home()}/Projects/herdra/herdr-app/toast/install`;
const SNAPSHOT = "herdra.snapshot";
const SHAPE = 4; // the herdra mod's snapshot layout; another `shape` is not read
const DEFAULT_TIMEOUT = -1; // Hokum's default (~6 s) for every card; never 0 (sticky) unless Algorant asks

// Like omarchy-notification-send: busctl takes every value as one typed D-Bus argument; hints are
// (key, type, value) triples. A click argv (omarchy-exec-argv) and buttons (omarchy-actions) are JSON
// strings that Hokum runs without a shell. The returned `u <id>` is kept for replace and close.
async function notify(entry, app, summary, body, hints, timeout) {
  const all = ["urgency", "y", "1", "desktop-entry", "s", "herdr-app", ...hints];
  const r = await exec("busctl", [...BUS, "Notify", "susssasa{sv}i", app, String(entry.id ?? 0), "herdr-app", summary, body, "0",
    String(all.length / 3), ...all, String(timeout)]);
  if (r.code !== 0) throw new Error(r.stderr.trim());
  entry.id = Number(r.stdout.trim().split(" ").pop());
}

async function close(entry) {
  if (entry.id === null) return;
  const id = entry.id;
  entry.id = null;
  await exec("busctl", [...BUS, "CloseNotification", "u", String(id)]);
}

// One card's posts and closes run in order, each in its own task.
function enqueue(cx, entry, job) {
  entry.queue.push(job);
  if (entry.running) return;
  entry.running = true;
  cx.spawn(async () => {
    while (entry.queue.length) {
      try { await entry.queue.shift()(); } catch (e) { console.log(`alerts: ${e.message ?? e}`); }
    }
    entry.running = false;
  });
}

const card = () => ({ id: null, queue: [], running: false });

// ---- the Needs-you desk ----

// item id -> card + `shown` (the posted needs-you card's content, or null when none is up).
const desk = new Map();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Open <kind> follows the item's first post, else task, else agent link (open-item); Jump to Herdra
// shows Herdra's terminal. Clicking the card does what its first button does.
function buttons(item) {
  const links = item.links ?? [];
  const link = ["post", "task", "agent"].map((k) => links.find((l) => l.kind === k)).find(Boolean);
  const list = [];
  if (link) list.push({ label: `Open ${link.kind}`, argv: [`${appHome()}/mods/alerts/open-item`, link.kind, link.target] });
  list.push({ label: "Jump to Herdra", argv: [`${appHome()}/mods/alerts/herdr-jump`, "herdra"] });
  return list;
}

// Every desk card carries the item's stack tag, so it replaces its own earlier card even after a
// reload lost the id; needs-you cards are transient (not brought back by a Hokum restart: the mod
// posts them again at start).
function deskHints(item, actions, transient) {
  const hints = ["x-canonical-private-synchronous", "s", `herdra-open:${item.id}`,
    "omarchy-actions", "s", JSON.stringify(actions), "omarchy-exec-argv", "s", JSON.stringify(actions[0].argv)];
  if (transient) hints.push("transient", "b", "true");
  return hints;
}

// The kind and the project make the card's app name, which the Hokum rules read (hokum-cards.kdl): the
// kind picks the colour and the project is shown beside it. An item with no kind is "Needs you".
// The project as people say it: herdra → Herdra, .pi stays .pi.
const projectName = (p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p);
const label = (item, word) => [word ?? item.kind ?? "Needs you", projectName(item.project)].filter(Boolean).join(" · ");

// The title is the item's `what` (the ask), the body its recommendation; no ids, no prefix.
function needsCard(item) {
  return { app: label(item), summary: item.what, body: esc(item.rec ?? ""), actions: buttons(item) };
}

function deskSync(cx, items) {
  const seen = new Set();
  for (const item of items) {
    // A row herdra-open derived from an owner's reply (`answered`) is Herdra's cue, not a notification: the
    // owner answered, nobody delivered it yet, and the card belongs to the real delivery. Skipping it also
    // keeps the desk quiet when the derived row appears and when the record's next write ends it.
    if (item.answered) continue;
    seen.add(item.id);
    let entry = desk.get(item.id);
    if (!entry) desk.set(item.id, entry = { ...card(), shown: null });
    if (item.section === "you") {
      const c = needsCard(item), key = JSON.stringify(c);
      if (entry.shown === key) continue;
      entry.shown = key;
      enqueue(cx, entry, () => notify(entry, c.app, c.summary, c.body, deskHints(item, c.actions, true), DEFAULT_TIMEOUT));
    } else if (entry.shown !== null) {
      entry.shown = null;
      if (item.closed) {
        const summary = item.closed.note || item.what;
        enqueue(cx, entry, () => notify(entry, label(item, "Done"), summary, esc(item.what), deskHints(item, buttons(item), false), DEFAULT_TIMEOUT));
      } else {
        enqueue(cx, entry, () => close(entry));
      }
    }
  }
  for (const [id, entry] of desk) {
    if (seen.has(id)) continue;
    desk.delete(id);
    if (entry.shown !== null) enqueue(cx, entry, () => close(entry));
  }
}

async function readItems() {
  const r = await exec(HERDRA_OPEN, ["list", "--json", "--closed", "24h"]);
  if (r.code !== 0) throw new Error(`herdra-open: ${r.stderr.trim() || `exit ${r.code}`}`);
  return JSON.parse(r.stdout);
}

// The items the herdra mod keeps in the shared snapshot, in the shape deskSync takes. That mod owns
// open.jsonl on the machine that has it and keeps `fast` current, so this machine runs nothing.
function snapshotItems() {
  const fast = shared(SNAPSHOT)?.fast;
  if (fast?.shape !== SHAPE) return [];
  return [...fast.you, ...fast.progress, ...fast.next, ...fast.pending, ...fast.done].map((it) => ({
    id: it.id, section: it.section, what: it.what, kind: it.kind, project: it.project, rec: it.rec,
    options: it.options, links: it.links, on: it.on,
    closed: it.closedAt ? { at: it.closedAt, note: it.note } : undefined,
  }));
}

// ---- the mirror ----

// address -> card + `status` + `shown` (the posted card's body, or null when none is up). Only the first render's statuses and the statuses of agents that
// appear later are recorded without posting.
const known = new Map();
let started = false;

export default class Alerts extends View {
  // The desk: watch the local open.jsonl where it lives, read the shared snapshot on another machine.
  init(_props, cx) {
    // task-76: Herdr's in-app toast for agent alerts is hidden by our toast mod (herdr-app/toast), which
    // Herdr's own copy replaces after an app update. This reinstalls ours (a no-op when it's in place).
    cx.spawn(async () => {
      try {
        const r = await exec(TOAST_INSTALL, []);
        if (r.code !== 0) throw new Error(r.stderr.trim());
      } catch (e) { console.log(`alerts: toast install: ${e.message ?? e}`); }
    });
    cx.timer.every(2000, (cx) => {
      mirror(cx);
      if (machines().some((machine) => machine.name === "desktop")) deskSync(cx, snapshotItems());
    });
    // The machine that has open.jsonl (desktop is not a machine it reaches over hc) watches it instead.
    if (!machines().some((machine) => machine.name === "desktop")) {
      cx.spawn(async (cx) => {
        for (;;) {
          try { deskSync(cx, await readItems()); } catch (e) { console.log(`alerts: ${e.message ?? e}`); }
          for (;;) {
            const paths = await watchFolder(STATE);
            if (paths.includes(LOG) || paths.includes(STATE)) break;
          }
        }
      });
    }
  }

  // The mirror also runs on a timer: render() only runs while the window is drawn, and a Herdr window
  // on another workspace or behind others is not drawn, which is exactly when an alert matters (task-84).
  render(cx) {
    mirror(cx);
    return div();
  }
}

function mirror(cx) {
  const list = agents().filter((a) => !terminalOf(a.address)?.parent);
  const looking = window()?.active ? focused()?.tab ?? null : null;
  const seen = new Set();
  for (const a of list) {
    seen.add(a.address);
    const entry = known.get(a.address);
    if (!entry) {
      known.set(a.address, { ...card(), status: a.status, shown: null });
      continue;
    }
    let c;
    if (entry.status !== a.status) {
      entry.status = a.status;
      c = (a.status === "blocked" && a.tab !== looking) || a.status === "done" ? alertCard(a) : null;
    } else if (entry.shown !== null) {
      c = alertCard(a); // its words can arrive after the alert (pi.say, the question): replace the card
      if (c?.body === entry.shown) continue;
    } else {
      continue;
    }
    if (c) {
      entry.shown = c.body;
      const argv = JSON.stringify([`${appHome()}/mods/alerts/herdr-jump`, a.address]);
      enqueue(cx, entry, async () => notify(entry, "Herdr", `${await whoLabel(a.address)} ${c.word}`, esc(c.body), ["omarchy-exec-argv", "s", argv], -1));
    } else {
      entry.shown = null;
      enqueue(cx, entry, () => close(entry));
    }
  }
  if (started) {
    for (const [address, entry] of known) {
      if (seen.has(address)) continue;
      known.delete(address);
      enqueue(cx, entry, () => close(entry));
    }
  }
  started = true;
}

// The card for an agent's alert, or null when it isn't for Algorant (task-108). Pi labels the terminal
// with who started the turn (pi.turn: person|agent) and its reply's one line (pi.say); a blocked Pi
// reports the question in its OSC 7501 msg (terminals()[].report.msg).
function alertCard(a) {
  const t = terminalOf(a.address);
  const labels = t?.labels ?? {};
  const machine = a.address.includes("/") ? `${a.address.split("/")[0]} · ` : "";
  const place = `${machine}${a.program.name} · ${a.space_name} › ${a.tab_name}`;
  if (a.status === "blocked") {
    const question = oneLine(t?.report?.msg);
    return { word: "needs you", body: question ? machine + question : place };
  }
  if (labels["pi.turn"] === "agent") return null;
  const say = labels["pi.turn"] === "person" ? oneLine(labels["pi.say"]) : "";
  return { word: "finished", body: say ? machine + say : place };
}

const oneLine = (s) => String(s ?? "").split("\n")[0].trim().slice(0, 200);

// The agent's name is whois's label (the one resolver, task-585).
async function whoLabel(address) {
  const r = await exec(WHOIS, ["--json", address]);
  const w = r.stdout.trim() ? JSON.parse(r.stdout)[0] : { error: r.stderr.trim() || `exit ${r.code}` };
  if (w.error) throw new Error(`whois ${address}: ${w.error}`);
  return w.label;
}

function terminalOf(address) {
  return terminals().find((t) => t.address === address);
}
