// Usage widget: reading the collector's records and deciding what each number may be shown as.
// Pure code (no Herdr imports). Every figure is one of: fresh, stale with its age, or unavailable
// with its reason. A value past its budget or past its window's reset is never shown as current,
// and a missing value is never turned into 0. The collector (collect.mjs) writes the records.

export const OWNER = "desktop";            // the host that collects (quota is account-wide)
export const FRESH_MS = 10 * 60_000;       // nothing refetches in the background: a reading fetched when the window opened is current for 10 min
export const SHORT_LIMIT_MS = 60 * 60_000;       // how long a window of 6 h or less, or of unknown length, is shown
export const LONG_LIMIT_MS = 24 * 60 * 60_000;   // and a longer one
export const PLAN_STALE_MS = 24 * 60 * 60_000;   // the plan label is read every 6 h

export const PROVIDERS = [
  { id: "codex", name: "Codex", tab: "Codex", icon: "data/usage/assets/codex.svg" },
  { id: "claude", name: "Claude", tab: "Claude", icon: "data/usage/assets/claude.svg" },
  { id: "xai", name: "Grok", tab: "Grok", icon: "data/usage/assets/xai.svg" },
  { id: "opencode-go", name: "OpenCode Go", tab: "OpenCode", icon: "data/usage/assets/opencode-go.svg" },
];

const ms = (iso) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

// One record file: { state: "missing" } (not collected yet), { state: "error", error }, or { state: "ready", rec }.
export function parseRecord(text) {
  if (text === null) return { state: "missing" };
  let rec;
  try { rec = JSON.parse(text); } catch { return { state: "error", error: "record unreadable" }; }
  if (!rec || rec.schema !== 1 || typeof rec.provider !== "string") return { state: "error", error: "record has an unknown shape" };
  return { state: "ready", rec };
}

// ---------------------------------------------------------------- formatting

export function age(since, now) {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return h % 24 > 0 ? `${d}d ${h % 24}h ago` : `${d}d ago`;
}

export function countdown(span) {
  const mins = Math.max(0, Math.floor(span / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60), m = mins % 60;
  if (hours < 24) return m > 0 ? `${hours}h ${m}m` : `${hours}h`;
  const days = Math.floor(hours / 24), h = hours % 24;
  return h > 0 ? `${days}d ${h}h` : `${days}d`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function clock(at, now) {
  const date = new Date(at);
  const h = date.getHours(), m = String(date.getMinutes()).padStart(2, "0");
  const time = `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
  return date.toDateString() === new Date(now).toDateString() ? time : `${DAYS[date.getDay()]} ${time}`;
}

export function tokens(n) {
  const trim = (v) => v.toFixed(1).replace(/\.0$/, "");
  if (n < 1000) return String(n);
  if (n < 1e6) return `${trim(n / 1e3)}K`;
  if (n < 1e9) return `${trim(n / 1e6)}M`;
  return `${trim(n / 1e9)}B`;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------- why there is no number

// The reason an attempt did not give a reading, in words; null for a successful attempt.
export function attemptReason(a, id, host, now) {
  if (!a || a.outcome === "ok") return null;
  const where = host ? ` on ${host}` : "";
  const next = " · Refresh retries";
  switch (a.outcome) {
    case "auth":
      if (a.httpStatus === 403 && id === "opencode-go") return "OpenCode refused the key: no Go subscription, or the key lacks Usage: Read · Refresh retries";
      if (a.httpStatus) return `sign-in rejected (HTTP ${a.httpStatus}): log in again in Pi${where} · Refresh retries`;
      if (a.detail === "pi_not_found") return `pi not found${where} · Refresh retries`;
      return `sign-in needed: /login in Pi${where} · Refresh retries`;
    case "rate_limited": return `rate limited until ${a.retryAt ? clock(ms(a.retryAt), now) : "later"}`;
    case "http": return `provider returned HTTP ${a.httpStatus ?? "error"}${next}`;
    case "timeout": return `request timed out${next}`;
    case "network": return `network error${a.detail ? ` (${a.detail})` : ""}${next}`;
    case "malformed": return `unexpected response from the provider${a.detail ? ` (${a.detail})` : ""}${next}`;
    case "unsupported":
      if (a.detail === "percentage_omitted") return "no percentage in the response; it may be 0% at the start of a period, but that is unconfirmed";
      if (a.detail === "claude_version_failed") return `claude --version failed${where}`;
      return "not supported for this account";
    default: return `attempt failed (${a.outcome})`;
  }
}

// ---------------------------------------------------------------- limits

// What the Limits section shows for one provider.
//   state: "fresh" | "stale" | "unavailable"
//   age:   when the newest successful reading was fetched ("3m ago"), if there is one
//   windows: [{ label, kind: "fresh" | "stale" | "reset" | "unavailable", pct?, resetMs?, note? }]
//   reason: why, when there is nothing to show (and the last failed attempt while a reading is shown)
export function limitsView(parsed, id, now) {
  if (parsed.state === "missing") return { state: "unavailable", windows: [], reason: "not collected yet" };
  if (parsed.state === "error") return { state: "unavailable", windows: [], reason: parsed.error };
  const rec = parsed.rec;
  const failure = attemptReason(rec.attempt, id, rec.host, now);
  const fetched = ms(rec.success?.fetchedAt);
  if (!rec.success || fetched === undefined || !Array.isArray(rec.success.windows)) {
    return { state: "unavailable", windows: [], reason: failure ?? "no reading yet" };
  }
  const old = now - fetched;
  const windows = rec.success.windows.map((w) => {
    const limit = typeof w.windowSeconds === "number" && w.windowSeconds > 6 * 3600 ? LONG_LIMIT_MS : SHORT_LIMIT_MS;
    const resetMs = ms(w.resetAt);
    if (old > limit) return { label: w.label, kind: "unavailable", note: `last reading ${age(fetched, now)}` };
    if (resetMs !== undefined && resetMs <= now) return { label: w.label, kind: "reset", resetMs };
    return { label: w.label, kind: old <= FRESH_MS ? "fresh" : "stale", pct: w.usedPercent, resetMs };
  });
  const shown = windows.some((w) => w.kind === "fresh" || w.kind === "stale" || w.kind === "reset");
  if (!shown) return { state: "unavailable", age: age(fetched, now), windows, reason: failure ?? `last reading ${age(fetched, now)}` };
  return { state: old <= FRESH_MS ? "fresh" : "stale", age: age(fetched, now), windows, reason: failure ?? undefined };
}

// The plan label under the name. Null when none was ever read, so nothing is invented.
export function planView(parsed, now) {
  const plan = parsed.state === "ready" ? parsed.rec.plan : undefined;
  if (!plan?.label) return null;
  const at = ms(plan.fetchedAt);
  const stale = at === undefined || now - at > PLAN_STALE_MS;
  return { label: plan.label, stale, age: at === undefined ? undefined : age(at, now) };
}

// ---------------------------------------------------------------- tokens

// Tokens by day (the last 7 local days ending today, oldest first) and by model, from this machine's
// Pi sessions. A day the scan did not cover is unknown (value undefined), never 0.
//   state: "fresh" | "stale" | "unavailable"
export function tokensView(parsed, now) {
  if (parsed.state !== "ready") return { state: "unavailable", reason: parsed.state === "missing" ? "not scanned yet" : parsed.error };
  const t = parsed.rec.tokens;
  const scanned = ms(t?.scannedAt);
  const host = parsed.rec.host;
  if (!t || scanned === undefined || !Array.isArray(t.days)) {
    return { state: "unavailable", host, reason: t?.error ? `scan failed: ${t.error}` : "not scanned yet" };
  }
  const byDate = new Map(t.days.map((d) => [d.date, d.tokens]));
  const today = new Date(now);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const date = localDate(d);
    days.push({ date, label: i === 0 ? "Today" : DAYS[d.getDay()], today: i === 0, tokens: byDate.get(date) });
  }
  return {
    state: now - scanned <= FRESH_MS ? "fresh" : "stale",
    host,
    age: age(scanned, now),
    note: t.outcome === "error" ? `last scan failed: ${t.error}` : undefined,
    days,
    models: Array.isArray(t.models) ? t.models : [],
  };
}
