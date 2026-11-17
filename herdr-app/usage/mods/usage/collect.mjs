#!/usr/bin/env node

// The Usage widget's own collector (Herdra task-52): plan limits of the four subscription
// providers (Claude, Codex, Grok, OpenCode Go) plus this machine's token history from Pi's
// session logs, written as timestamped records the widget reads. It runs on its own, with no Pi
// conversation involved. Dependency-free Node.
//
// Credentials come only from Pi's documented export (`pi auth print-bearer-token` /
// `print-api-key`), run with execFile and held in this process's memory: never in a file, a
// log, a record or an argv. Nothing else is read (not auth.json, ~/.claude, ~/.codex, ~/.grok).
//
// Nothing schedules it: the Usage window runs it when it opens and when asked.
//   collect.mjs --open       the window opened: each provider at most every 3 minutes
//   collect.mjs --refresh    the person asked: like --open, and it lifts a sign-in pause
//   --dry-run                nothing is sent or written; prints what would run
//   --dry-run <dir>          the same code on canned responses <dir>/<provider>.json
//   --state <dir>            the record folder (default <app home>/data/usage)
//
// Records, one file per provider, are described in RECIPE.md.
import { execFile } from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const run = promisify(execFile);

// Every provider host also publishes IPv6, which this network cannot route. Node's happy-eyeballs
// gives each address 250 ms, so a latency spike failed working IPv4 connections. Try IPv4 first
// and give each attempt room (the same fix Omarchy's collector carries).
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(2500);

const VERSION = "0.1.0";
const UA = `herdr-usage/${VERSION}`;
const MIN = 60_000;
const RATE_LIMIT_MS = 15 * MIN;     // after a 429: wait at least this (doubling per repeat), or Retry-After if longer
const FLOOR_MS = 3 * MIN;            // a provider is never attempted sooner than this after its last attempt
const PLAN_OK_MS = 6 * 60 * MIN;     // the plan label is read this often
const PLAN_RETRY_MS = 60 * MIN;      // after a failed plan read
const BACKOFF_CAP_MS = 120 * MIN;    // the 429 wait doubles from RATE_LIMIT_MS up to this
const RUN_MS = 25_000;               // the whole run, lock wait included (exec's limit is 30 s)
const LOCK_WAIT_MS = 6_000;
const LOCK_STALE_MS = 40_000;
const REQUEST_MS = 10_000;
const AUTH_MS = 8_000;
const MAX_BYTES = 1_000_000;
const TOKEN_DAYS = 7;
const SESSION_ROOTS = [join(homedir(), ".pi", "agent", "sessions"), join(homedir(), ".omp", "agent", "sessions")];

// ------------------------------------------------------------------ arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const dryRun = flag("--dry-run");
const fixtures = value("--dry-run");
const stateArg = value("--state");
const stateDir = stateArg ?? join(process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"), "data", "usage");
const triggers = ["--open", "--refresh"].filter(flag);

if (flag("--help") || triggers.length !== 1) {
  console.log(`Usage: collect.mjs (--open | --refresh) [--dry-run [<responses dir>]] [--state <dir>]
Records: ${stateDir}/<provider>.json`);
  process.exit(flag("--help") ? 0 : 2);
}
const trigger = triggers[0].slice(2);
// Records are written by a real run, or by a canned run only into a folder named with --state.
const writes = !dryRun || (fixtures !== undefined && stateArg !== undefined);
// A canned run reads existing records only from an explicit --state, so it never judges against the real ones.
const readsState = !dryRun || fixtures === undefined || stateArg !== undefined;

class Failure extends Error {
  constructor(outcome, { httpStatus, detail, retryAfterMs } = {}) {
    super(outcome);
    this.outcome = outcome;
    this.httpStatus = httpStatus;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

// ------------------------------------------------------------------ credentials and identity

// Pi's documented export. The value is returned to the caller and goes nowhere else.
async function credential(p, ctx) {
  if (ctx.fixtures) {
    const canned = await readCanned(ctx, p.id);
    if (canned?.__auth === "timeout") throw new Failure("timeout", { detail: "pi_auth_timeout" });
    if (canned?.__auth) throw new Failure("auth", { detail: `pi_auth_${canned.__auth}` });
    return "canned-token";
  }
  const argv = ["auth", p.bearer ? "print-bearer-token" : "print-api-key", "--provider", p.pi];
  if (p.bearer) argv.push("--min-expiry", "30m");
  let out;
  try {
    out = (await run("pi", argv, { timeout: AUTH_MS, maxBuffer: 16_384, signal: ctx.signal })).stdout.trim();
  } catch (e) {
    if (e?.code === "ENOENT") throw new Failure("auth", { detail: "pi_not_found" });
    if (e?.killed || e?.name === "AbortError") throw new Failure("timeout", { detail: "pi_auth_timeout" });
    throw new Failure("auth", { detail: "pi_auth_failed" });
  }
  if (!out) throw new Failure("auth", { detail: "pi_auth_empty" });
  if (!/^[\x21-\x7e]+$/.test(out)) throw new Failure("auth", { detail: "pi_auth_malformed" });
  return out;
}

// Claude's route wants a Claude Code User-Agent; its version is whatever `claude --version` says now.
async function claudeVersion(ctx) {
  try {
    const { stdout } = await run("claude", ["--version"], { timeout: 5_000, maxBuffer: 4_096, signal: ctx.signal });
    const v = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
    if (v) return v;
  } catch {}
  throw new Failure("unsupported", { detail: "claude_version_failed" });
}

// ------------------------------------------------------------------ http

async function readCanned(ctx, key) {
  let text;
  try { text = await readFile(join(ctx.fixtures, `${key}.json`), "utf8"); } catch { return undefined; }
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

function failureForStatus(status, retryAfter) {
  if (status === 429) {
    const seconds = retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter);
    const wait = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
    return new Failure("rate_limited", { httpStatus: 429, retryAfterMs: Number.isFinite(wait) && wait > 0 ? wait : 0 });
  }
  if (status === 401 || status === 403) return new Failure("auth", { httpStatus: status });
  return new Failure("http", { httpStatus: status });
}

// One GET. `req` is { key, url, headers }; a canned run answers from <dir>/<key>.json instead.
async function get(req, ctx) {
  if (ctx.fixtures) {
    const canned = await readCanned(ctx, req.key);
    if (canned === undefined) throw new Failure("http", { httpStatus: 404, detail: "no_canned_response" });
    if (canned.__network) throw new Failure(canned.__network === "timeout" ? "timeout" : "network", { detail: "canned" });
    if (canned.__status && canned.__status !== 200) throw failureForStatus(canned.__status, canned.__retryAfter);
    if (canned.__raw !== undefined) throw new Failure("malformed", { detail: "not_json" });
    return canned.__body !== undefined ? canned.__body : canned;
  }
  let res;
  try {
    res = await fetch(req.url, { headers: req.headers, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(REQUEST_MS), ctx.signal]) });
  } catch (e) {
    if (ctx.signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") throw new Failure("timeout", { detail: ctx.signal.aborted ? "deadline" : "request" });
    throw new Failure("network", { detail: String(e?.cause?.code || e?.name || "error").slice(0, 40) });
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw failureForStatus(res.status, res.headers.get("Retry-After"));
  }
  const reader = res.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.byteLength;
      if (bytes > MAX_BYTES) throw new Failure("malformed", { detail: "too_large" });
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof Failure) throw e;
    if (ctx.signal.aborted) throw new Failure("timeout", { detail: "deadline" });
    throw new Failure("malformed", { detail: "not_json" });
  }
}

// ------------------------------------------------------------------ mapping responses

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const percent = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const isoOf = (v, seconds = false) => {
  if (v === undefined || v === null || v === "") return undefined;
  const d = new Date(seconds ? Number(v) * 1000 : v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
};
const text = (v, max = 40) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const window_ = (id, label, usedPercent, windowSeconds, resetAt) => ({ id, label, usedPercent, ...(windowSeconds && { windowSeconds }), ...(resetAt && { resetAt }) });

// A label for a window length the provider reported. Nothing is assumed when it reported none.
function spanLabel(seconds) {
  if (seconds === 18_000) return "5h window";
  if (seconds === 604_800) return "Weekly";
  if (seconds === 2_592_000) return "Monthly";
  if (seconds % 3600 === 0 && seconds < 86_400) return `${seconds / 3600}h window`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d window`;
  return `${Math.round(seconds / 60)}m window`;
}

function mapClaude(json) {
  if (!isObject(json)) throw new Failure("malformed", { detail: "not_object" });
  const windows = [];
  for (const [key, label, seconds] of [["five_hour", "5h window", 18_000], ["seven_day", "Weekly", 604_800], ["seven_day_opus", "Weekly · Opus", 604_800], ["seven_day_sonnet", "Weekly · Sonnet", 604_800]]) {
    const w = json[key];
    const used = isObject(w) ? percent(w.utilization) : undefined;
    if (used !== undefined) windows.push(window_(key, label, used, seconds, isoOf(w.resets_at)));
  }
  return { windows };
}

// organization_type "claude_pro" -> "Pro"; "claude_max" with rate_limit_tier "..._max_20x" -> "Max 20x".
function mapClaudePlan(json) {
  const org = json?.organization;
  const type = typeof org?.organization_type === "string" ? org.organization_type.replace(/^claude_/, "") : "";
  if (!type) throw new Failure("malformed", { detail: "no_plan" });
  const multiple = typeof org.rate_limit_tier === "string" ? org.rate_limit_tier.match(/_(\d+x)$/)?.[1] : undefined;
  return type.charAt(0).toUpperCase() + type.slice(1) + (multiple ? ` ${multiple}` : "");
}

function mapCodex(json) {
  if (!isObject(json)) throw new Failure("malformed", { detail: "not_object" });
  const windows = [];
  const add = (rate, prefix, name) => {
    for (const [key, generic] of [["primary_window", "Primary window"], ["secondary_window", "Secondary window"]]) {
      const w = rate?.[key];
      const used = isObject(w) ? percent(w.used_percent) : undefined;
      if (used === undefined) continue;
      const seconds = typeof w.limit_window_seconds === "number" && w.limit_window_seconds > 0 ? w.limit_window_seconds : undefined;
      const label = seconds ? spanLabel(seconds) : generic;
      windows.push(window_(`${prefix}${key.replace("_window", "")}`, name ? `${name} · ${label}` : label, used, seconds, isoOf(w.reset_at, true)));
    }
  };
  add(json.rate_limit, "");
  for (const extra of Array.isArray(json.additional_rate_limits) ? json.additional_rate_limits : []) {
    const name = text(extra?.limit_name) ?? text(extra?.metered_feature);
    if (name) add(extra.rate_limit, `${name}:`, name);
  }
  return { windows, plan: text(json.plan_type) };
}

function mapGrok(json) {
  const config = isObject(json) && isObject(json.config) ? json.config : undefined;
  if (!config) throw new Failure("malformed", { detail: "no_config" });
  const period = isObject(config.currentPeriod) ? config.currentPeriod : undefined;
  const used = percent(config.creditUsagePercent);
  // proto3 JSON drops a zero, so a period without a percentage may really be 0%, but nothing says so.
  if (used === undefined) throw new Failure(period ? "unsupported" : "malformed", { detail: period ? "percentage_omitted" : "no_period" });
  const type = String(period?.type ?? "").toLowerCase();
  const [label, seconds] = type.includes("month") ? ["Monthly", 2_592_000] : type.includes("week") ? ["Weekly", 604_800] : type.includes("day") ? ["Daily", 86_400] : ["Credits", undefined];
  const start = Date.parse(period?.start), end = Date.parse(period?.end ?? config.billingPeriodEnd);
  const length = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : seconds;
  return { windows: [window_("credits", label, used, length, isoOf(period?.end ?? config.billingPeriodEnd))] };
}

const mapGrokPlan = (json) => {
  const label = text(json?.subscription_tier_display) ?? text(json?.subscription_tier);
  if (!label) throw new Failure("malformed", { detail: "no_plan" });
  return label;
};

// A window is a reading whenever it carries a percent, whatever its status: an exhausted window
// comes as { status: "rate-limited", percent: 100 } (task-144). The Go route answers only a key
// with a Go subscription (otherwise 403), so a read names the plan Go; no API tells Go from Go Plus or Go Teams.
function mapOpencode(json) {
  const usage = isObject(json) && isObject(json.usage) ? json.usage : undefined;
  if (!usage) throw new Failure("malformed", { detail: "no_usage" });
  const windows = [];
  for (const [key, label, seconds] of [["rolling", "5h window", 18_000], ["weekly", "Weekly", 604_800], ["monthly", "Monthly", 2_592_000]]) {
    const w = usage[key];
    const used = isObject(w) ? percent(w.percent) : undefined;
    if (used !== undefined) windows.push(window_(key, label, used, seconds, isoOf(w.resetsAt)));
  }
  return { windows, plan: "Go" };
}

// ------------------------------------------------------------------ providers

const bearer = (token, ua) => ({ Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": ua });
const grokHeaders = (token, ua) => ({ ...bearer(token, ua), "x-xai-token-auth": "xai-grok-cli" });
const claudeHeaders = (token, ua) => ({ ...bearer(token, ua), "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20" });

const PROVIDERS = [
  { id: "codex", name: "Codex", pi: "openai-codex", bearer: true, session: ["openai-codex", "openai"],
    ua: async () => UA,
    quota: (token, ua) => ({ key: "codex", url: "https://chatgpt.com/backend-api/wham/usage", headers: bearer(token, ua) }),
    map: mapCodex },
  { id: "claude", name: "Claude", pi: "anthropic", bearer: true, session: ["anthropic"],
    ua: async (ctx) => `claude-code/${await claudeVersion(ctx)}`,
    quota: (token, ua) => ({ key: "claude", url: "https://api.anthropic.com/api/oauth/usage", headers: claudeHeaders(token, ua) }),
    map: mapClaude,
    plan: (token, ua) => ({ key: "claude.plan", url: "https://api.anthropic.com/api/oauth/profile", headers: claudeHeaders(token, ua) }),
    mapPlan: mapClaudePlan },
  { id: "xai", name: "Grok", pi: "xai", bearer: true, session: ["xai"],
    ua: async () => UA,
    quota: (token, ua) => ({ key: "xai", url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits", headers: grokHeaders(token, ua) }),
    map: mapGrok,
    plan: (token, ua) => ({ key: "xai.plan", url: "https://cli-chat-proxy.grok.com/v1/settings", headers: grokHeaders(token, ua) }),
    mapPlan: mapGrokPlan },
  { id: "opencode-go", name: "OpenCode", pi: "opencode-go", bearer: false, session: ["opencode-go"],
    ua: async () => UA,
    quota: (token, ua) => ({ key: "opencode-go", url: "https://opencode.ai/zen/go/v1/usage", headers: bearer(token, ua) }),
    map: mapOpencode },
];

// ------------------------------------------------------------------ one provider

const iso = (ms) => new Date(ms).toISOString();
const backoff = (failures) => Math.min(RATE_LIMIT_MS * 2 ** Math.max(0, failures - 1), BACKOFF_CAP_MS);

// Whether a provider is attempted now, or why not. `requestedAt` is when this run started: a record
// attempted since then was made by a concurrent run whose result this run adopts instead of repeating.
function dueCheck(rec, now, requestedAt) {
  const a = rec?.attempt;
  if (!a) return { run: true };
  if (Date.parse(a.startedAt) >= requestedAt) return { run: false, why: "attempted by a concurrent run" };
  if (a.outcome === "rate_limited" && Date.parse(a.retryAt) > now) return { run: false, why: `rate limited until ${a.retryAt}` };
  if (trigger === "open" && a.paused) return { run: false, why: "paused: sign-in needed (--refresh retries)" };
  const since = now - Date.parse(a.startedAt);
  if (since < FLOOR_MS) return { run: false, why: `attempted ${Math.round(since / 1000)}s ago` };
  return { run: true };
}

async function collectProvider(p, rec, ctx) {
  const startedMs = Date.now();
  const prev = rec?.attempt;
  const out = { schema: 1, provider: p.id, host: hostname(), plan: rec?.plan ?? { outcome: "none" }, ...(rec?.success && { success: rec.success }), ...(rec?.tokens && { tokens: rec.tokens }) };
  const attempt = { startedAt: iso(startedMs), trigger };
  try {
    const ua = await p.ua(ctx);
    const token = await credential(p, ctx);
    const quota = p.map(await get(p.quota(token, ua), ctx));
    if (quota.windows.length === 0) throw new Failure("malformed", { detail: "no_windows" });
    const fetchedMs = Date.now();
    out.success = { fetchedAt: iso(fetchedMs), windows: quota.windows };
    attempt.outcome = "ok";
    attempt.failures = 0;
    if (!p.plan) {
      // Codex and OpenCode Go name the plan in the quota read itself.
      if (quota.plan) out.plan = { label: quota.plan, fetchedAt: iso(fetchedMs), outcome: "ok" };
    } else if (p.plan && !(Date.parse(out.plan.nextDueAt) > fetchedMs)) {
      // The plan name is its own read with its own status: a failure here never costs the limits.
      try {
        out.plan = { label: p.mapPlan(await get(p.plan(token, ua), ctx)), fetchedAt: iso(Date.now()), outcome: "ok", nextDueAt: iso(Date.now() + PLAN_OK_MS) };
      } catch (e) {
        const f = e instanceof Failure ? e : new Failure("malformed", { detail: "internal" });
        out.plan = { ...out.plan, outcome: f.outcome, ...(f.httpStatus && { httpStatus: f.httpStatus }), ...(f.detail && { detail: f.detail }), nextDueAt: iso(Date.now() + PLAN_RETRY_MS) };
      }
    }
  } catch (e) {
    const f = e instanceof Failure ? e : new Failure("malformed", { detail: "internal" });
    const now = Date.now();
    const failures = f.outcome === "rate_limited" ? (prev?.failures ?? 0) + 1 : prev?.failures ?? 0;   // consecutive 429s
    Object.assign(attempt, { outcome: f.outcome, failures, ...(f.httpStatus && { httpStatus: f.httpStatus }), ...(f.detail && { detail: f.detail }) });
    if (f.outcome === "auth") attempt.paused = true;
    else if (f.outcome === "rate_limited") attempt.retryAt = iso(now + Math.max(f.retryAfterMs ?? 0, backoff(failures)));
  }
  attempt.finishedAt = iso(Date.now());
  out.attempt = attempt;
  return out;
}

// ------------------------------------------------------------------ token history

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function sessionFiles(cutoffMs, signal) {
  const files = [];
  let found = 0;
  for (const root of SESSION_ROOTS) {
    let names;
    try { names = await readdir(root, { recursive: true }); } catch (e) { if (e?.code === "ENOENT") continue; throw e; }
    found++;
    for (const name of names) {
      if (signal.aborted) throw new Error("deadline");
      if (!name.endsWith(".jsonl")) continue;
      const path = join(root, name);
      if ((await stat(path)).mtimeMs >= cutoffMs) files.push(path);
    }
  }
  if (found === 0) throw new Error("no Pi session folder");
  return files;
}

// Per provider id: { days: {date: tokens}, models: {model: tokens} } over the last TOKEN_DAYS local days.
async function scanTokens(signal) {
  const today = new Date();
  const dates = [];
  for (let i = TOKEN_DAYS - 1; i >= 0; i--) dates.push(localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
  const inWindow = new Set(dates);
  const byProvider = new Map(PROVIDERS.map((p) => [p.id, { days: Object.fromEntries(dates.map((d) => [d, 0])), models: {} }]));
  const owner = new Map(PROVIDERS.flatMap((p) => p.session.map((s) => [s, p.id])));
  const files = await sessionFiles(Date.now() - (TOKEN_DAYS + 1) * 86_400_000, signal);
  const seen = new Set();
  let skipped = 0;
  for (const file of files) {
    if (signal.aborted) throw new Error("deadline");
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    let n = 0;
    for await (const line of lines) {
      n++;
      if (!line.includes('"usage"') || !line.includes('"provider"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { skipped++; continue; }
      const m = entry?.type === "message" ? entry.message : undefined;
      const target = m?.role === "assistant" ? byProvider.get(owner.get(m.provider)) : undefined;
      if (!target || !isObject(m.usage)) continue;
      const key = `${file}:${entry.id ?? n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const u = m.usage;
      const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
      const total = num(u.input) + num(u.output) + num(u.cacheRead) + num(u.cacheWrite) || num(u.totalTokens);
      const at = new Date(entry.timestamp ?? m.timestamp);
      if (total <= 0) continue;
      if (!Number.isFinite(at.getTime())) { skipped++; continue; }
      const day = localDate(at);
      if (!inWindow.has(day)) continue;
      target.days[day] += total;
      const model = text(m.model, 80) ?? m.provider;
      target.models[model] = (target.models[model] ?? 0) + total;
    }
  }
  return { byProvider, dates, files: files.length, skipped };
}

// ------------------------------------------------------------------ records and the lock

async function readRecord(id) {
  try { return JSON.parse(await readFile(join(stateDir, `${id}.json`), "utf8")); } catch { return undefined; }
}

async function writeRecord(rec) {
  const tmp = join(stateDir, `.${rec.provider}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
  await rename(tmp, join(stateDir, `${rec.provider}.json`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };

// An O_EXCL lock file. Returns a release function, or undefined when another run held it for LOCK_WAIT_MS.
async function lock() {
  const path = join(stateDir, ".lock");
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const f = await open(path, "wx", 0o600);
      await f.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await f.close();
      return () => unlink(path).catch(() => {});
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    try {
      const held = JSON.parse(await readFile(path, "utf8"));
      if (Date.now() - held.at > LOCK_STALE_MS || !alive(held.pid)) { await unlink(path).catch(() => {}); continue; }
    } catch (e) {
      if (e?.code === "ENOENT") continue;
      await unlink(path).catch(() => {});
      continue;
    }
    if (Date.now() >= until) return undefined;
    await sleep(150);
  }
}

// ------------------------------------------------------------------ main

async function describePlan(ctx, records) {
  const now = Date.now();
  console.log(`collect.mjs ${VERSION} dry run (${trigger}): nothing is sent, read from Pi or written`);
  console.log(`state: ${readsState ? stateDir : "not read"}`);
  for (const p of PROVIDERS) {
    const rec = records.get(p.id);
    const due = dueCheck(rec, now, Infinity);
    let ua;
    try { ua = await p.ua(ctx); } catch (e) { ua = `unresolved (${e.detail})`; }
    console.log(`\n${p.id}: ${due.run ? "would attempt" : `would skip, ${due.why}`}`);
    console.log(`  credential: pi ${["auth", p.bearer ? "print-bearer-token" : "print-api-key", "--provider", p.pi, ...(p.bearer ? ["--min-expiry", "30m"] : [])].join(" ")}`);
    for (const req of [p.quota("<redacted>", ua), ...(p.plan ? [p.plan("<redacted>", ua)] : [])]) {
      console.log(`  GET ${req.url}`);
      console.log(`      headers: ${Object.entries(req.headers).map(([k, v]) => `${k}: ${k === "Authorization" ? "Bearer <redacted>" : v}`).join("; ")}`);
    }
  }
  console.log(`\ntokens: Pi sessions under ${SESSION_ROOTS.join(", ")}, last ${TOKEN_DAYS} local days`);
}

async function main() {
  const requestedAt = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RUN_MS);
  const ctx = { signal: abort.signal, fixtures };
  let release;
  try {
    if (writes) {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      release = await lock();
      if (!release) { console.log(JSON.stringify({ busy: true, note: "collection in progress" })); return; }
    }
    const records = new Map();
    if (readsState) for (const p of PROVIDERS) { const r = await readRecord(p.id); if (r) records.set(p.id, r); }
    if (dryRun && fixtures === undefined) { await describePlan(ctx, records); return; }

    const now = Date.now();
    const skipped = {};
    const chosen = PROVIDERS.filter((p) => {
      const d = dueCheck(records.get(p.id), now, requestedAt);
      if (!d.run) skipped[p.id] = d.why;
      return d.run;
    });
    const attempts = Array.from(records.values()).map((r) => Date.parse(r.tokens?.attemptedAt ?? 0)).filter(Number.isFinite);
    const lastScan = attempts.length ? Math.max(...attempts) : 0;
    const scanDue = lastScan < requestedAt && now - lastScan >= FLOOR_MS;

    const [results, scan] = await Promise.all([
      Promise.all(chosen.map((p) => collectProvider(p, records.get(p.id), ctx))),
      scanDue ? scanTokens(abort.signal).catch((e) => ({ error: String(e?.code || e?.message || "scan failed").slice(0, 80) })) : undefined,
    ]);
    const out = new Map(PROVIDERS.map((p) => [p.id, results.find((r) => r.provider === p.id) ?? records.get(p.id)]));
    if (scan) {
      const at = iso(Date.now());
      for (const p of PROVIDERS) {
        const base = out.get(p.id) ?? { schema: 1, provider: p.id, host: hostname(), plan: { outcome: "none" } };
        const prevTokens = base.tokens ?? {};
        const t = scan.error
          ? { ...prevTokens, attemptedAt: at, outcome: "error", error: scan.error, source: "pi sessions" }
          : (() => {
              const s = scan.byProvider.get(p.id);
              return { scannedAt: at, attemptedAt: at, outcome: "ok", source: "pi sessions", files: scan.files, skipped: scan.skipped,
                days: scan.dates.map((date) => ({ date, tokens: s.days[date] })),
                models: Object.entries(s.models).map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens) };
            })();
        out.set(p.id, { ...base, tokens: t });
      }
    }
    if (writes) for (const rec of out.values()) if (rec) await writeRecord(rec);
    if (dryRun) for (const rec of out.values()) if (rec) console.log(JSON.stringify(rec));
    console.log(JSON.stringify({ ran: results.map((r) => ({ provider: r.provider, outcome: r.attempt.outcome })), skipped, tokens: scan ? (scan.error ? `error: ${scan.error}` : "scanned") : "not due" }));
  } finally {
    clearTimeout(timer);
    await release?.();
  }
}

await main();
