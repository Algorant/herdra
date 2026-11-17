/**
 * How Herdra's list looks above the editor: a header line with the counts, then
 * one line per open item, a dim dashed rule between sections, then the one blank
 * line that separates the list from the editor.
 *
 * Colours come from the theme only, and only as accents (herdra task-131, middle
 * version): blue/`mdLink` for every project's tag, so a row reads who has it, then
 * what it is; the words in `text`; sand/`warning` for the ▸ on a row that waits on
 * Algorant and for an age gone stale; green/`accent` for the ● of work in progress;
 * grey/`muted` for held work and for the rule; red/`error` for an agent gone idle.
 * Nothing else, so the list is no longer one flat colour and follows the theme.
 *
 * Nothing here reads or writes anything: index.ts hands it a View built from
 * `bin/herdra-open list --json` and one `hc ls`. A row says each thing once: its
 * text does not repeat its tag, and a row with a post link ends in a clickable ↗.
 * A Needs-you row may carry one grey line under it — its recommendation, or the
 * first line of his ask (task-139) — so what he must decide is on screen beside the
 * row and not only in the chat.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** One line of the list. */
export type Row = {
	/** Who has it: the project that holds it (`herdra`, `.pi`, `homelab-server`), or a section word. */
	tag: string;
	glyph: string;
	/** The row's own colour, as a theme name: its glyph, and its tag when the tag is a section word. */
	color: "warning" | "accent" | "text" | "muted";
	text: string;
	/** A Needs-you row's kind, lower-cased: `decide`, `approve`, `check` or `read`. */
	kind?: string;
	/** A Needs-you row's own line: its recommendation, or the first line of his ask (task-139). */
	detail?: string;
	/** Only an In progress or Needs-you row has one: its age, or herdra-open's idle mark. */
	right?: { text: string; color: "muted" | "warning" | "error" };
	/** A row whose item has a post link ends in a clickable ↗ to it. */
	post?: string;
	/** The first row of a section after the first: one dim dashed rule is drawn above it. */
	sep?: boolean;
};

export type View = {
	counts: { you: number; progress: number; next: number; pending: number };
	you: Row[];
	progress: Row[];
	next: Row[];
	pending: Row[];
	/** Pending drawn in full instead of as a count: /pending or alt+o flips it, in memory only. */
	pendingOpen?: boolean;
	/** Shown instead of the list when the one source could not be read. */
	error?: string;
};

/** The tag column is as wide as the longest tag, never wider than this. */
const TAG_MAX = 10;
/** The list is a glance, not a page: at most this many item lines. */
const LINES_MAX = 10;
/** What waits on Algorant and what is being worked on each get at most this many. */
const SECTION_MAX = 4;
/** Up next is the short list of what could start now. */
const NEXT_MAX = 3;
/** Beyond this, Pending is a count: those items wait on a time, not on a move. */
const PENDING_MAX = 2;
/** At most this many Needs-you rows carry their recommendation or ask under them: a glance, not a page. */
const DETAIL_MAX = 2;
/** Between the tag column and the glyph. */
const TAG_GAP = "  ";
/** The section words a row's text never needs to repeat. */
const SECTION_WORDS = new Set(["you", "next", "pending"]);
/** The glyph a row with a post link ends in, and what it is drawn in: the theme's link colour
 * (verdigris' `secondary`), underlined, inside the OSC 8 hyperlink around it. */
const POST_GLYPH = "↗";
const POST_COLOR = "mdLink" as const;
/** The colour of every project's tag: the theme's link blue. Sand is left with two jobs only — the
 * ▸ of a row that waits on Algorant and an age gone stale — and green with one, the ●. */
const TAG_COLOR = "mdLink" as const;
/** Between sections: one dim line of these, dashed so it is never read as a border. */
const SECTION_RULE = "╌";
const UNDERLINE_ON = "\u001b[4m";
const UNDERLINE_OFF = "\u001b[24m";
const OSC8_ON = "\u001b]8;;";
const OSC8_END = "\u001b\\";

/** The clickable ↗ for one row: a clean glyph in the read, its link only in the terminal's hands. */
function postMarker(url: string, theme: Theme): string {
	return `${OSC8_ON}${url}${OSC8_END}${theme.fg(POST_COLOR, `${UNDERLINE_ON}${POST_GLYPH}${UNDERLINE_OFF}`)}${OSC8_ON}${OSC8_END}`;
}

/**
 * A row says each thing once: text that repeats the row's own tag drops it, whether trailing
 * (`(homelab-server)`) or leading (`homelab-server: `). The section words are not the item's subject.
 */
function sayOnce(row: Row): Row {
	const tag = row.tag.trim();
	if (!tag || SECTION_WORDS.has(tag.toLowerCase())) return row;
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const text = row.text
		.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "i"), "")
		.replace(new RegExp(`^\\s*${escaped}:\\s+`, "i"), "");
	return text === row.text ? row : { ...row, text };
}

type Color = Parameters<Theme["fg"]>[0];

/**
 * Lay coloured segments across a pane in order, each one as much as still fits, and hand back what is
 * drawn and the room left over. pi-tui throws on an over-wide widget line instead of wrapping it, so
 * every line this file draws goes through here (herdra task-126).
 */
function fitSegments(segments: { text: string; color: Color }[], theme: Theme, width: number): { drawn: string; room: number } {
	let room = width;
	let drawn = "";
	for (const segment of segments) {
		if (room <= 0) break;
		const text = truncateToWidth(segment.text, room, "");
		if (!text) continue;
		room -= visibleWidth(text);
		drawn += theme.fg(segment.color, text);
	}
	return { drawn, room };
}

/**
 * The header: `── herdra · 2 need you · 3 in progress`, then the dash fill to the pane's edge. A
 * pane narrower than the lead truncates it across its three parts before the fill is worked out, so
 * the header is never wider than the pane.
 */
function headerLine(view: View, theme: Theme, width: number): string {
	const { you: y, progress: p, next: n, pending: d } = view.counts;
	const parts: string[] = [];
	if (y) parts.push(`${y} need you`);
	if (p) parts.push(`${p} in progress`);
	if (n) parts.push(`${n} next`);
	if (d) parts.push(`${d} pending`);
	const tail = parts.length ? ` · ${parts.join(" · ")}` : "";
	const { drawn, room } = fitSegments(
		[
			{ text: "── ", color: "muted" },
			{ text: "herdra", color: "accent" },
			{ text: tail + " ", color: "muted" },
		],
		theme,
		width,
	);
	return drawn + theme.fg("dim", "─".repeat(room));
}

/**
 * The rows to draw, in the order they mean: what waits on Algorant, then who is
 * working, then what could start now, then what is held. Each section that has
 * more than its room says how many it left out instead of growing without end;
 * the header counts stay the full truth, so nothing is silently dropped. The first
 * row of every section after the first carries the marker that draws a rule above it.
 */
function drawRows(view: View): Row[] {
	const capped = (rows: Row[], cap: number): Row[] =>
		rows.length > cap
			? [...rows.slice(0, cap - 1), { tag: "", glyph: "", color: "muted", text: `+${rows.length - (cap - 1)} more` }]
			: rows;
	const you = capped(view.you.map(sayOnce), SECTION_MAX);
	const next = view.next.map(sayOnce).slice(0, NEXT_MAX);
	const pending =
		view.pending.length > PENDING_MAX && !view.pendingOpen
			? [{ tag: "pending", glyph: "◌", color: "muted" as const, text: `${view.pending.length} pending · alt+o to show` }]
			: view.pending.map(sayOnce);
	// The one normalized In progress list, so a row that survives the line limit is the same text
	// as one that did not.
	const running = view.progress.map(sayOnce);
	let progress = capped(running, SECTION_MAX);
	// Opened, Pending is his to read: it does not eat In progress's room.
	const held = view.pendingOpen ? 1 : pending.length;
	const total = you.length + progress.length + next.length + held;
	if (total > LINES_MAX) {
		const room = LINES_MAX - (you.length + next.length + held);
		progress = room > 0 ? capped(running, room) : [];
	}
	// One section after another, each non-empty section's first row marked so a rule goes above it.
	// A section this read left empty draws nothing and earns no rule, so a rule never opens the list
	// under the header and two rules never meet.
	const rows: Row[] = [];
	for (const section of [you, progress, next, pending]) {
		for (const [position, row] of section.entries()) rows.push(position === 0 && rows.length > 0 ? { ...row, sep: true } : row);
	}
	return rows;
}

/** The tag's colour: the project's blue, or the row's own colour for the section words. */
function tagColor(row: Row): Row["color"] | typeof TAG_COLOR {
	const word = row.tag.trim().toLowerCase();
	return !word || SECTION_WORDS.has(word) ? row.color : TAG_COLOR;
}

function rowLine(row: Row, tagWidth: number, theme: Theme, width: number): string {
	const tag = truncateToWidth(row.tag.toLowerCase(), TAG_MAX).padEnd(tagWidth, " ");
	const lead = `${tag}${TAG_GAP}${row.glyph} `;
	// The right side, in this order: the kind, then the age (or the idle mark), then the post's ↗.
	// Only the visible text of each part enters the width maths; the OSC 8 and SGR escapes are
	// appended with the suffix, after the padding.
	const parts: { text: string; ansi: string }[] = [];
	if (row.kind) parts.push({ text: row.kind, ansi: theme.fg("muted", row.kind) });
	if (row.right?.text) parts.push({ text: row.right.text, ansi: theme.fg(row.right.color, row.right.text) });
	if (row.post) parts.push({ text: POST_GLYPH, ansi: postMarker(row.post, theme) });
	const visible = (list: typeof parts) => (list.length ? ` ${list.map((part) => part.text).join(" ")}` : "");
	// A narrow pane gives way in the same order: the kind goes first, then the age (or the idle
	// mark), and the ↗ only when it alone cannot fit. The subject truncates into what is left, so
	// a row is one line at any width.
	while (parts.length && visibleWidth(lead) + visibleWidth(visible(parts)) > width) parts.shift();
	const suffix = visible(parts);
	// A pane narrower than the lead itself (the tag column, the gap and the glyph) truncates the lead,
	// as the header does: no subject or right side fits, so the row is the lead and stops at the edge.
	if (visibleWidth(lead) > width) {
		return fitSegments(
			[
				{ text: tag, color: tagColor(row) },
				{ text: TAG_GAP + row.glyph, color: row.color },
				{ text: " ", color: row.color === "muted" ? "muted" : "text" },
			],
			theme,
			width,
		).drawn;
	}
	const room = Math.max(0, width - visibleWidth(lead) - visibleWidth(suffix));
	const text = truncateToWidth(row.text, room, "…");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(lead) - visibleWidth(text) - visibleWidth(suffix)));
	return (
		theme.fg(tagColor(row), tag) +
		theme.fg(row.color, TAG_GAP + row.glyph) +
		// The words carry the text colour, so colour stays an accent; a held row stays muted, so it
		// never reads brighter than work in progress.
		theme.fg(row.color === "muted" ? "muted" : "text", ` ${text}`) +
		pad +
		(parts.length ? " " + parts.map((part) => part.ansi).join(" ") : "")
	);
}

/**
 * The line under a Needs-you row: its recommendation or the first line of his ask, in grey, indented to
 * where the row's own words start. One line at any width, like every other line here.
 */
function detailLine(row: Row, tagWidth: number, theme: Theme, width: number): string {
	const indent = " ".repeat(Math.max(0, Math.min(tagWidth + TAG_GAP.length + 2, width - 1)));
	const room = Math.max(0, width - visibleWidth(indent));
	return theme.fg("muted", indent + truncateToWidth(String(row.detail ?? ""), room, "…"));
}

/** The whole widget: header, rules between sections, rows, and the blank line before the editor. */
export function renderView(view: View, theme: Theme, width: number): string[] {
	if (view.error) {
		return [theme.fg("error", truncateToWidth(`herdra-open: ${view.error}`, width, "…")), ""];
	}
	const rows = drawRows(view);
	if (rows.length === 0) return [];
	const tagWidth = Math.min(TAG_MAX, Math.max(...rows.map((row) => visibleWidth(row.tag))));
	// A Needs-you row's detail is a second line, so it is paid for out of the same line budget: the
	// first rows that carry one get it while the list still fits, and no row is dropped for it.
	const budget = Math.min(DETAIL_MAX, Math.max(0, LINES_MAX - rows.length));
	let details = 0;
	const out = [headerLine(view, theme, width)];
	for (const row of rows) {
		if (row.sep) out.push(theme.fg("dim", SECTION_RULE.repeat(width)));
		out.push(rowLine(row, tagWidth, theme, width));
		if (row.detail && details < budget) {
			out.push(detailLine(row, tagWidth, theme, width));
			details += 1;
		}
	}
	out.push("");
	return out;
}
