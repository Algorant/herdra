/**
 * What ties a row to the words Algorant typed (herdra task-128, task-135, task-139).
 *
 * The turn-end check must fire on the row his message is about and stay quiet otherwise, so a
 * shared word has to say what the row is about. Two kinds of word do not: filler, and the list's
 * own vocabulary — `list`, `sideshow`, `approve`, `/reload`, `herdra`, `window`, `widget`, a
 * restart — which is on nearly every row and in nearly every message he writes about the list, so
 * it tied rows he never meant (the 2026-11-11 false matches: `herdra`, `proposal`, `reload`,
 * `sideshow`, `here`, `whats`). A project name is too coarse for the same reason: naming `.pi`
 * does not say which of its rows he meant, so a row's own project never ties it.
 *
 * Two shared words used to be enough, and that flagged rows he never meant whenever a message
 * reused words two rows also carry (`link`, `status`, a project name on several of its rows): the
 * 2026-11-12 reply about shelf-pin folders and a review page flagged the dotfiles-switch row. So a
 * row is tied by what it leads with: one id (a digit, hyphen, dot or colon in it — `task-124`,
 * `o372`) that no other row on screen carries, or the row's subject (the first distinctive word of
 * its line, once its project's own name is left out), or two shared words when at least one of them
 * is on no other row. Naming only the project is not enough, and neither is one word it happens to
 * share: `links` on the dotfiles row does not make a message about something else a message about it.
 *
 * One authority: the Herdra window's turn-end check (`pi/herdra-open-widget`) and `bin/herdra-open`'s
 * add-time nudge at a row that looks like one already open read the same tokens and the same rule.
 */

/** The row as it was on screen: what it is about, and what to compare his words against. */
export type Seen = { id: string; tokens: string[] };

/** Filler: too common to tie a row to what he typed, whatever the row says. */
const FILLER = new Set([
	"the", "this", "that", "with", "from", "your", "have", "has", "will", "just", "then", "than", "them",
	"they", "when", "what", "whats", "which", "about", "into", "only", "also", "more", "most", "some",
	"such", "very", "could", "should", "would", "after", "before", "still", "need", "needs", "wait",
	"waits", "waiting", "item", "items", "thing", "things", "here", "there", "does", "doesn", "didn",
	"this", "and", "for", "not", "but", "its", "you", "his", "him", "she", "her", "one", "two", "any",
	"all", "out", "now", "how", "why", "who", "yes", "yeah", "ok", "okay", "good", "sure", "fine",
	"done", "say", "pick",
]);

/**
 * The list's own words: the subject of the widget, the shapes every row takes (a post, an
 * approval, a check, a reload, a restart), and the machine and app it lives in. He writes them
 * whenever he talks about Herdra, so they tie nothing.
 */
const LIST_WORDS = new Set([
	"list", "lists", "bar", "header", "widget", "widgets", "herdra", "herdr", "sideshow", "tandem",
	"proposal", "proposals", "propose", "proposed", "approve", "approved", "approves", "approval",
	"check", "checks", "checking", "review", "reviewer", "reviewers", "task", "tasks", "board",
	"boards", "window", "windows", "look", "looks", "looking", "looked", "fix", "fixes", "fixed",
	"merge", "merged", "merging", "reload", "reloads", "reloaded", "pi-reload", "restart", "restarts",
	"restarted", "reopen", "reopens", "reopened", "quit", "quits", "close", "closes", "closed",
	"app", "apps", "workspace", "session", "sessions", "post", "posts", "record", "footer",
]);

/** The words of a row's own project: it names a project, not the row, so it never ties one. */
function projectWords(project: string | undefined): string[] {
	const name = String(project ?? "").trim().toLowerCase();
	if (!name) return [];
	const words = new Set([name]);
	for (const part of name.split(/[^\p{L}\p{N}]+/u)) if (part) words.add(part);
	return [...words];
}

/** A word that ties a row: not filler, not the list's own, not its project, and either an id or four letters. */
function distinctive(token: string): boolean {
	if (FILLER.has(token) || LIST_WORDS.has(token)) return false;
	return /[\d.:-]/.test(token) || token.length >= 4;
}

/** A token carrying a digit, a hyphen, a dot or a colon is an id (`task-115`, `.pi`, `o372`). */
const isId = (token: string): boolean => /[\d.:-]/.test(token);

/**
 * What a row is about: the words of its own line, a linked Task id (as written and its `task-N`), a
 * post's last path segment, an agent's name — without its own project's words. A word carrying a
 * digit, a hyphen, a dot or a colon matches inside a longer word (`.pi`, `task-115`); a plain word
 * matches whole.
 */
export function tokensOf(item: {
	what: string;
	project?: string;
	links?: { kind: string; target: string }[];
}): string[] {
	const own = new Set(projectWords(item.project));
	const tokens = new Set<string>();
	for (const word of item.what.toLowerCase().split(/\s+/)) {
		const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
		if (clean && !own.has(clean)) tokens.add(clean);
	}
	for (const link of item.links ?? []) {
		const target = String(link.target ?? "").replace(/[?#].*$/, "");
		if (link.kind === "task") {
			tokens.add(target.toLowerCase());
			tokens.add((target.split(":").pop() ?? "").toLowerCase());
		}
		if (link.kind === "post") tokens.add((target.split("/").filter(Boolean).pop() ?? "").toLowerCase());
		if (link.kind === "agent") tokens.add((target.split("/").pop() ?? "").toLowerCase());
	}
	tokens.delete("");
	return [...tokens];
}

/**
 * What a row leads with: its subject, the first distinctive word of its line (`dotfiles`, `pages`,
 * `screenshots`). It is the word a message about the row repeats even when it shares nothing else,
 * and the one the two-word rule does not need.
 */
export function subjectOf(tokens: string[]): string[] {
	const [first] = tokens.filter(distinctive);
	return first ? [first] : [];
}

/** Is one of the row's words in his message? An id matches inside a word; a plain word matches whole. */
function touched(token: string, words: string): boolean {
	if (isId(token)) return words.includes(token);
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}\\b`).test(words);
}

/** The distinctive words his message shares with the row, in the row's own order. */
export function sharedWith(row: Seen, words: string): string[] {
	return row.tokens.filter((token) => distinctive(token) && touched(token, words));
}

/**
 * Did his message touch this row? One shared id that no other row on screen carries; or the row's
 * subject word; or two shared words with at least one of them on no other row. `rows` is every row
 * that was on screen with it.
 */
export function touchedRow(row: Seen, rows: Seen[], words: string): boolean {
	const hits = sharedWith(row, words);
	if (hits.length === 0) return false;
	const elsewhere = (token: string): boolean => rows.some((other) => other.id !== row.id && other.tokens.includes(token));
	if (hits.some((token) => isId(token) && !elsewhere(token))) return true;
	const subject = subjectOf(row.tokens);
	if (hits.some((token) => subject.includes(token))) return true;
	return hits.length >= 2 && hits.some((token) => !elsewhere(token));
}

/**
 * How much of what he typed a row shares with another row of the same project, for
 * `bin/herdra-open`'s hint at `add`: the new row's own words that the open row also carries, plus
 * whether they include the open row's subject. Two shared words, or one shared subject word, is
 * enough to be worth saying out loud; nothing is closed or changed on that guess.
 */
export function duplicatesOf(
	row: { what: string; project?: string; links?: { kind: string; target: string }[] },
	others: {
		id: string;
		what: string;
		project?: string;
		asked?: boolean;
		links?: { kind: string; target: string }[];
	}[],
): { id: string; what: string; shared: string[]; subject: boolean; asked: boolean }[] {
	const mine = new Set(tokensOf(row));
	const out: { id: string; what: string; shared: string[]; subject: boolean; asked: boolean }[] = [];
	for (const other of others) {
		const theirs = tokensOf(other);
		const shared = theirs.filter((token) => mine.has(token) && distinctive(token));
		const subject = subjectOf(theirs).some((token) => mine.has(token));
		if (shared.length >= 2 || subject) out.push({ id: other.id, what: other.what, shared, subject, asked: other.asked === true });
	}
	return out;
}
