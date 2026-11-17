/**
 * Herdra's open items above the editor (herdra task-120).
 *
 * A small Pi extension kept in the herdra repo, drawing what `bin/herdra-open`
 * records: what waits on Algorant, who is working on what, what could start
 * next, and what is pending. One source, no second list: every line comes from
 * `bin/herdra-open list --json`, which already carries `bin/herdra-silent`'s
 * idle mark, and from one `hc ls --json` that names the project holding an item.
 * Nothing is written.
 *
 * Where it draws: only in Herdra's own Pi, the Pi in the `herdra` space's `main`
 * tab with no parent — the same "a Ceph" rule the Herdra mod uses. A Worker in
 * that tab (it has a parent), a manus (its own tab) and every other project's Pi
 * get nothing. The extension also loads only where the project settings list it
 * (the repo's `.pi/settings.json`); the guard is the rule that decides.
 *
 * When it reads: Pi's own events (`turn_start`, `turn_end`, `agent_settled`),
 * the first `session_start` (re-tried once on the first input or turn when hc had not yet listed this
 * Pi as herdra / main), a change to `open.jsonl` (fs.watch, debounced),
 * and at most one one-shot timer for the moment an idle mark could first
 * appear. No interval, no polling. At the last boundary of a run he started
 * (`agent_before_settle`) it also checks, once, that the Needs-you rows his
 * typed words touched actually moved; that is the only read a turn adds.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dur, SILENT_S } from "../../bin/lib/silent.ts";
import { tokensOf, touchedRow, type Seen as SeenRow } from "../../bin/lib/match.ts";
import { renderView, type Row, type View } from "./render.ts";

const WIDGET_KEY = "herdra-open";
/** The repo this extension lives in: its own record is the data source. */
const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPT = join(REPO, "bin", "herdra-open");
/** Debounce for a change on disk, so one write is one read. */
const DEBOUNCE_MS = 250;
/** An age is worth a note only once the item is this old: a row that just moved says nothing. */
const AGE_SHOW_S = 60 * 60;
/** Past this, the age is a warning: the item has been sitting too long. */
const AGE_STALE_S = 6 * 60 * 60;
/** How many Needs-you rows render.ts draws before it collapses the rest: the only ones he can see. */
const YOU_ROWS = 4;
/** The one-row decision he types instead of naming the row ("ok, do B", "yes", "go ahead"). */
const DECISION = /^(?:ok(?:ay)?|yes|yeah|yep|sure|fine|approved?|go ahead|go for it|do it|proceed|option [a-e]|[a-e])\b/;

/**
 * The record calls that can move one row, named exactly, as the turn-end check hands them over
 * (task-139): the answer to a row that carries its inbox thread, then the ways to record what he
 * did with it — updated, dismissed, deferred. One call, chosen from these; never a hand-edited list.
 */
function moveOf(item: Item): string {
	const id = item.id;
	const answer = (item.links ?? []).some((link) => link.kind === "thread") ? `answer ${id} "<his answer>" · ` : "";
	return `bin/herdra-open ${answer}update ${id} --waiting "<what now>" · close ${id} "<what ended it>" · update ${id} --parked`;
}

type Item = {
	id: string;
	section: "you" | "progress" | "next" | "pending" | "done" | string;
	project?: string;
	what: string;
	on?: string;
	at: string;
	updated?: string;
	kind?: string;
	/** His ask and Herdra's recommendation: a Needs-you row draws the recommendation's line under it. */
	ask?: string;
	rec?: string;
	/** The reply's headline when herdra-open derived an answered row (task-121); never written to the record. */
	answer?: string;
	silent?: { status: string; at: string; age: number; mark: string };
	history?: unknown[];
	links?: { kind: string; target: string }[];
};

/** A Needs-you row as it was on screen when the run began. */
type Seen = SeenRow & { key: string };

type Terminal = {
	address: string;
	agent?: string | null;
	name?: string | null;
	where?: string | null;
	parent?: string | null;
	status?: string | null;
};

type Run = { out: string; err: string; code: number };

function run(command: string, args: string[]): Promise<Run> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
	});
}

function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
}

/** What the record shows for a row: any of these changing means it moved. */
function keyOf(item: Item): string {
	return `${item.id}@${item.updated ?? item.at}@${item.history?.length ?? 0}`;
}

/** One record of `herdra-open list --json`, or a clear failure. */
async function readItems(): Promise<Item[]> {
	const { out, err, code } = await run(SCRIPT, ["list", "--json"]);
	if (code !== 0) throw new Error(`herdra-open list failed (exit ${code})${err.trim() ? `: ${firstLine(err)}` : ""}`);
	const items: unknown = JSON.parse(out);
	if (!Array.isArray(items)) throw new Error("herdra-open list --json did not print a list");
	return items as Item[];
}

async function hcJson(args: string[]): Promise<any> {
	const { out, err, code } = await run("hc", args);
	if (code !== 0) throw new Error(`hc ${args.join(" ")} failed (exit ${code})${err.trim() ? `: ${firstLine(err)}` : ""}`);
	return JSON.parse(out);
}

const machineOf = (address: string): string => (address.includes("/") ? address.split("/")[0] : "");
const idOf = (address: string): string => address.split("/").pop() as string;

/**
 * The live terminals an item's `on` names, resolved the way `bin/lib/silent.ts`
 * resolves them (and herdra-silent before it): an address, a terminal id or
 * name on the same machine, `name@machine`, or a project, whose Ceph is the Pi
 * in that space's `main` tab.
 */
function ownersOf(on: string, live: Terminal[]): Terminal[] {
	const [name = "", at] = String(on ?? "").split("@");
	const wanted = at === undefined ? name : `${at}/${name}`;
	return live.filter((terminal) => {
		const where = String(terminal.where ?? "").split(" / ");
		const sameMachine = machineOf(terminal.address) === (at ?? "");
		const named = terminal.address === wanted || (sameMachine && (idOf(terminal.address) === name || terminal.name === name));
		const ceph =
			(at === undefined || sameMachine) &&
			terminal.agent === "pi" &&
			String(where[0]).toLowerCase() === name.toLowerCase() &&
			where[1] === "main";
		return named || ceph;
	});
}

/**
 * The tag for a row: the project that holds it, or the word for its section. A
 * Ceph's item names its project already; an agent on another machine whose
 * terminal is not listed falls back to the machine, never to a raw address.
 */
function tagOf(item: Item, live: Terminal[]): string {
	const owner = ownersOf(String(item.on ?? ""), live)[0];
	const space = owner ? String(owner.where ?? "").split(" / ")[0] : "";
	if (space) return space;
	const raw = String(item.on ?? item.project ?? "?");
	return raw.includes("@") ? raw.split("@")[1] : raw;
}

function ageOf(item: Item, now: number): string {
	const raised = Math.floor(Date.parse(item.updated ?? item.at) / 1000);
	return Number.isFinite(raised) ? dur(now - raised) : "";
}

/** How long since the item last moved, in seconds; zero when the record's time cannot be read. */
function secondsOf(item: Item, now: number): number {
	const raised = Math.floor(Date.parse(item.updated ?? item.at) / 1000);
	return Number.isFinite(raised) ? Math.max(0, now - raised) : 0;
}

/** A Needs-you row's kind, lower-cased, as the record already spells it. */
function kindOf(item: Item): string | undefined {
	const kind = String(item.kind ?? "").trim().toLowerCase();
	return kind || undefined;
}

/**
 * The line a Needs-you row carries under it (task-139): Herdra's recommendation when the item has
 * one, else the first line of his ask — so a row he must decide is never only a terse title. An
 * answered row drops it: the answer is on the row already.
 */
function detailOf(item: Item): string | undefined {
	if (item.answer) return undefined;
	const line = (text: string | undefined): string | undefined =>
		String(text ?? "")
			.split("\n")
			.map((part) => part.replace(/\*\*|`/g, "").replace(/^(?:asked|answer|question)\s*:\s*/i, "").trim())
			.find((part) => part.length > 0);
	return line(item.rec) ?? line(item.ask);
}

/**
 * The item's post, when Algorant can open it: the row ends in a clickable ↗ to it. Only an http(s)
 * URL without control characters is one — a record's target goes inside an OSC 8 sequence, so
 * nothing else may reach the row.
 */
const POST_URL = /^https?:\/\/[^\u0000-\u001f\u007f]+$/i;
function postOf(item: Item): string | undefined {
	const target = (item.links ?? []).find((link) => link.kind === "post")?.target;
	return typeof target === "string" && POST_URL.test(target) ? target : undefined;
}

/**
 * What a row says about its age: herdra-open's idle mark in red, or — only once the item is old
 * enough to be a question — its age in grey, and in sand past the stale threshold. A row that
 * moved within the hour says nothing, so the right-hand side is a note and not a clock.
 */
function ageRight(item: Item, now: number): Row["right"] {
	if (item.silent) return { text: item.silent.mark, color: "error" };
	const seconds = secondsOf(item, now);
	if (seconds < AGE_SHOW_S) return undefined;
	return { text: ageOf(item, now), color: seconds >= AGE_STALE_S ? "warning" : "muted" };
}

function progressRow(item: Item, live: Terminal[], now: number): Row {
	return {
		tag: tagOf(item, live),
		glyph: "●",
		color: "accent",
		text: item.what,
		// A row an owner has answered (herdra-open's derived reply) says so instead of aging.
		right: item.answer ? { text: "answered", color: "muted" as const } : ageRight(item, now),
		post: postOf(item),
	};
}

function buildView(items: Item[], live: Terminal[], now: number): View {
	const of = (section: Item["section"]) => items.filter((item) => item.section === section);
	// What waits on Algorant is tagged with its own project, exactly like every other row: the sand
	// ▸ is the only mark that it is his. Its `on` is the person waiting there, so resolving it would
	// name the project of that name instead of the board the item sits on.
	const you: Row[] = of("you").map((item) => ({
		tag: String(item.project ?? ""),
		glyph: "▸",
		color: "warning",
		text: item.what,
		kind: kindOf(item),
		detail: detailOf(item),
		right: ageRight(item, now),
		post: postOf(item),
	}));
	const progress: Row[] = of("progress").map((item) => progressRow(item, live, now));
	const next: Row[] = of("next").map((item) => ({ tag: "next", glyph: "○", color: "text", text: item.what, post: postOf(item) }));
	const pending: Row[] = of("pending").map((item) => ({ tag: "pending", glyph: "◌", color: "muted", text: item.what, post: postOf(item) }));
	return {
		counts: { you: you.length, progress: progress.length, next: next.length, pending: pending.length },
		you,
		progress,
		next,
		pending,
	};
}

/** `open.jsonl`, the one record, as herdra-open reads it. */
function stateFile(): string {
	const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	return join(base, "herdra", "open.jsonl");
}

export default function (pi: ExtensionAPI) {
	let active = false;
	let view: View | undefined;
	let context: ExtensionContext | undefined;
	let tui: { requestRender(): void } | undefined;
	let theme: Theme | undefined;
	let watcher: FSWatcher | undefined;
	let fileTimer: ReturnType<typeof setTimeout> | undefined;
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;
	let running = false;
	let again = false;
	/** The items of the last completed read. */
	let lastItems: Item[] | undefined;
	/** The words he typed since the last settle, at most five: this run's words. */
	let typed: { text: string; at: number }[] = [];
	/** The Needs-you rows on screen when this run began. */
	let seen: Seen[] | undefined;
	/** This run already got its one check. */
	let reminded = false;
	/** Pending drawn in full (task-150): his toggle, in memory only, folded again on reload. */
	let pendingOpen = false;

	/** `alt+o` or `/pending`: flip Pending and redraw from the view in hand; no read, no hc call. */
	function togglePending(ctx: ExtensionContext): void {
		if (!active) return ctx.ui.notify("herdra-open: the list draws only in Herdra's own pane", "info");
		pendingOpen = !pendingOpen;
		if (view) view = { ...view, pendingOpen };
		draw();
	}
	const TOGGLE = "Show or fold the Pending section of Herdra's list";
	pi.registerCommand("pending", { description: TOGGLE, handler: async (_args, ctx) => togglePending(ctx) });
	pi.registerShortcut("alt+o", { description: TOGGLE, handler: async (ctx) => togglePending(ctx) });

	function draw(): void {
		tui?.requestRender();
	}

	/**
	 * Mount (or re-mount) the widget. Pi keeps above-editor widgets in the order
	 * they were set, and re-setting the same key moves it to the end — the place
	 * nearest the editor. Re-mounting on every read keeps Herdra's list below a
	 * pi-ui section that appeared after it, so the list is always the last block
	 * above the editor and its one trailing blank line is the only gap there.
	 */
	function mount(): void {
		if (!context) return;
		context.ui.setWidget(WIDGET_KEY, (ui, thm) => {
			tui = ui;
			theme = thm;
			return {
				render: (width: number) => (view && theme ? renderView(view, theme, width) : []),
				invalidate: () => {},
			};
		});
	}

	/**
	 * At most one one-shot wakeup: an In progress item whose owner is already
	 * idle cannot carry herdra-open's mark until it has been idle for SILENT_S,
	 * and that moment is known from the owner's status start and the item's
	 * last change. Nothing is armed while every owner is working.
	 */
	async function armWakeup(items: Item[], live: Terminal[]): Promise<void> {
		if (wakeTimer) {
			clearTimeout(wakeTimer);
			wakeTimer = undefined;
		}
		const now = Math.floor(Date.now() / 1000);
		const candidates = items.filter((item) => item.section === "progress" && !item.silent);
		if (candidates.length === 0) return;
		const owners = new Map<string, Terminal>();
		for (const item of candidates) {
			for (const terminal of ownersOf(String(item.on ?? ""), live)) {
				if (terminal.agent !== "pi") continue;
				if (terminal.status !== "idle" && terminal.status !== "done") continue;
				owners.set(terminal.address, terminal);
			}
		}
		let earliest: number | undefined;
		for (const address of owners.keys()) {
			let statusAt: number;
			try {
				statusAt = Math.floor(Number((await hcJson(["get", address, "--json"])).status_ms ?? 0) / 1000);
			} catch {
				continue;
			}
			if (!statusAt) continue;
			for (const item of candidates) {
				if (!ownersOf(String(item.on ?? ""), live).some((terminal) => terminal.address === address)) continue;
				const owed = Math.floor(Date.parse(item.updated ?? item.at) / 1000);
				const at = Math.max(statusAt, Number.isFinite(owed) ? owed : now) + SILENT_S + 1;
				if (at > now && (earliest === undefined || at < earliest)) earliest = at;
			}
		}
		if (earliest === undefined) return;
		wakeTimer = setTimeout(() => {
			wakeTimer = undefined;
			void refresh("timer");
		}, Math.max(1000, (earliest - now) * 1000));
		wakeTimer.unref?.();
	}

	async function refresh(reason: "start" | "event" | "file" | "timer"): Promise<void> {
		if (!active) return;
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			const [items, ls] = await Promise.all([readItems(), hcJson(["ls", "--json"])]);
			lastItems = items;
			const live: Terminal[] = Array.isArray(ls?.terminals) ? ls.terminals : [];
			view = { ...buildView(items, live, Math.floor(Date.now() / 1000)), pendingOpen };
			mount();
			draw();
			// A timer-fired read does not re-arm: one wakeup per event, never an interval.
			if (reason !== "timer") void armWakeup(items, live);
		} catch (error) {
			view = {
				counts: { you: 0, progress: 0, next: 0, pending: 0 },
				you: [],
				progress: [],
				next: [],
				pending: [],
				error: error instanceof Error ? error.message : String(error),
			};
			draw();
		} finally {
			running = false;
			if (again) {
				again = false;
				void refresh("event");
			}
		}
	}

	/** One read per burst of changes on disk. */
	function onFileChange(): void {
		if (fileTimer) return;
		fileTimer = setTimeout(() => {
			fileTimer = undefined;
			void refresh("file");
		}, DEBOUNCE_MS);
		fileTimer.unref?.();
	}

	function stop(): void {
		active = false;
		view = undefined;
		context = undefined;
		lastItems = undefined;
		typed = [];
		seen = undefined;
		reminded = false;
		if (fileTimer) clearTimeout(fileTimer);
		if (wakeTimer) clearTimeout(wakeTimer);
		fileTimer = undefined;
		wakeTimer = undefined;
		watcher?.close();
		watcher = undefined;
		recheck = false;
	}

	pi.on("session_shutdown", async (_event, ctx) => {
		stop();
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	/** The start check failed or came too early: one more try on the next natural event, then never again. */
	let recheck = false;

	/**
	 * Is this Pi Herdra's own, and if so mount and start reading. Returns whether it decided: false only
	 * when hc could not be read or has not yet listed this Pi as the pi agent in herdra / main — right
	 * after a restart hc can still show the terminal with no agent or tab (task-152).
	 */
	async function activate(ctx: ExtensionContext): Promise<boolean> {
		const id = process.env.HC_TERMINAL_ID;
		if (!id) return true; // not in a native hc terminal: nothing to draw for
		let live: Terminal[];
		try {
			const ls = await hcJson(["ls", "--json"]);
			live = Array.isArray(ls?.terminals) ? ls.terminals : [];
		} catch (error) {
			ctx.ui.notify(`herdra-open: cannot read hc: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return false;
		}
		// A local terminal's address is its bare id; matching that exactly keeps a
		// remote machine's lookalike id (machine/t…) out of the question.
		const self = live.find((terminal) => terminal.address === id);
		const [space = "", tab = ""] = String(self?.where ?? "").split(" / ");
		const isHerdra = Boolean(self) && self!.agent === "pi" && !self!.parent && space.toLowerCase() === "herdra" && tab === "main";
		if (!isHerdra) return false;
		active = true;
		context = ctx;
		mount();
		// Read once first: herdra-open creates the record's directory if it is missing.
		await refresh("start");
		const file = stateFile();
		try {
			watcher = watch(dirname(file), (_event, name) => {
				if (!name || name === "open.jsonl") onFileChange();
			});
			watcher.on("error", (error) => ctx.ui.notify(`herdra-open: watching ${file} stopped: ${String(error)}`, "warning"));
		} catch (error) {
			ctx.ui.notify(`herdra-open: cannot watch ${file}: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
		return true;
	}

	/** The one retry: the first input or turn after a start whose check did not match. */
	async function retryStart(ctx: ExtensionContext): Promise<void> {
		if (!recheck) return;
		recheck = false;
		await activate(ctx);
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		recheck = !(await activate(ctx));
	});

	pi.on("input", async (event, ctx) => {
		void retryStart(ctx);
		if (event.source === "extension") return; // his Pi's own `/fast` or `/pi-reload`, not his words
		const text = String(event.text ?? "");
		if (text.trim().length < 3) return;
		typed.push({ text, at: Date.now() });
		if (typed.length > 5) typed.shift();
		return { action: "continue" as const };
	});

	pi.on("turn_start", async (_event, ctx) => {
		void retryStart(ctx);
		// What he was looking at while typing: the Needs-you rows the widget drew (render.ts shows at most
		// YOU_ROWS of them and collapses the rest), from the last read.
		if (!seen) {
			const rows = (lastItems ?? []).filter((item) => item.section === "you");
			// Only the rows render.ts actually drew: with more than YOU_ROWS it draws YOU_ROWS - 1 and "+N more".
			seen = rows
				.slice(0, rows.length > YOU_ROWS ? YOU_ROWS - 1 : YOU_ROWS)
				.map((item) => ({ id: item.id, key: keyOf(item), tokens: tokensOf(item) }));
		}
		void refresh("event");
	});
	pi.on("turn_end", async () => {
		void refresh("event");
	});
	// Once per run he started: his words touched a Needs-you row that did not move.
	pi.on("agent_before_settle", async (event) => {
		if (!active || typed.length === 0 || !seen || seen.length === 0 || reminded) return;
		const words = typed.map((entry) => entry.text).join("\n").toLowerCase();
		typed = [];
		// In memory first, so a turn that names nothing costs no read at all. A decision he types instead of
		// naming the row ("ok, do B", "yes, go ahead") can only be about one row when only one was on screen.
		const tied = seen.filter((row) => touchedRow(row, seen, words) || (seen.length === 1 && DECISION.test(words)));
		if (tied.length === 0) return;
		let current: Item[];
		try {
			current = await readItems();
		} catch {
			return; // a broken record must not fail his turn
		}
		const there = new Map(current.filter((item) => item.section === "you").map((item) => [item.id, keyOf(item)]));
		const rows = tied.filter((row) => there.get(row.id) === row.key);
		if (rows.length === 0) return;
		reminded = true;
		const own = new Map(current.map((item) => [item.id, item]));
		const lines = rows.slice(0, 3).map((row) => {
			const item = own.get(row.id);
			const what = item?.what ?? "";
			return item ? `- "${what}" (${row.id}): ${moveOf(item)}` : `- "${what}" (${row.id})`;
		});
		if (rows.length > 3) lines.push(`- +${rows.length - 3} more`);
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message" as const,
					customType: "herdra-open-check",
					display: false,
					content: `herdra-open: your message touched rows still under Needs you and unchanged in the record. Move each with one call, in this turn; if he dismissed, deferred or answered it, close or park it instead of leaving it:\n${lines.join("\n")}`,
				},
			],
			continue: true,
		};
	});

	pi.on("agent_settled", async () => {
		typed = [];
		seen = undefined;
		reminded = false;
		void refresh("event");
	});
}
