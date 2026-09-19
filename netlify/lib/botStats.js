// Owner-only usage statistics for the interactive bot (the /stats command).
//
// Kept in the Netlify Blobs store "bot-stats":
//   day:YYYY-MM-DD   counters for one UTC day
//   total            the same counters for all time (+ "since": the day counting started)
//   user:<id>        { first, lastDay } — only so a user counts as "new" once and "active" once a day
//   top              popular downloads / searches / not-found searches (aggregated, no user ids)
//
// Netlify Blobs has no transactions, so two events landing in the very same instant can overwrite
// each other's increment. These numbers are meant for trends, not accounting — the authoritative
// payment record is still the charge:<id> entries in bot-accounts (see botAccount.js).
// Every write helper swallows its own errors: statistics must never break a customer's download.

const { connectLambda, getStore } = require("@netlify/blobs");

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_MAX = 150; // when a top list grows past this...
const TOP_KEEP = 100; // ...it is cut back to its 100 most frequent entries

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10); // "2026-09-19" (UTC)

function store(event) {
  connectLambda(event);
  return getStore("bot-stats");
}

async function readJson(s, key, fallback) {
  try {
    const raw = await s.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function bump(s, key, counters) {
  const rec = await readJson(s, key, {});
  if (key === "total" && !rec.since) rec.since = dayKey();
  for (const [k, n] of Object.entries(counters)) rec[k] = (rec[k] || 0) + n;
  await s.set(key, JSON.stringify(rec));
}

// Adds the given counters ({ search: 1, searchHit: 1 }) to today's record and to the all-time one.
async function track(event, counters) {
  try {
    const s = store(event);
    await Promise.all([bump(s, `day:${dayKey()}`, counters), bump(s, "total", counters)]);
  } catch (e) {
    console.error("Stats tracking failed:", e.message);
  }
}

// Call on every private message / button tap. Counts a user as "new" the first time we ever see
// them and as "active" the first time we see them each UTC day.
async function touchUser(event, userId) {
  try {
    const s = store(event);
    const today = dayKey();
    const key = `user:${userId}`;
    const rec = await readJson(s, key, null);
    if (rec && rec.lastDay === today) return;
    await s.set(key, JSON.stringify({ first: rec ? rec.first : today, lastDay: today }));
    await track(event, rec ? { active: 1 } : { active: 1, newUsers: 1 });
  } catch (e) {
    console.error("Stats user tracking failed:", e.message);
  }
}

// field: "books" | "queries" | "misses". Stored as [[label, count], ...] sorted by count.
async function bumpTop(event, field, label) {
  if (!label) return;
  try {
    const s = store(event);
    const rec = await readJson(s, "top", {});
    const list = Array.isArray(rec[field]) ? rec[field] : [];
    const hit = list.find((e) => e[0] === label);
    if (hit) hit[1] += 1;
    else list.push([label, 1]);
    list.sort((a, b) => b[1] - a[1]);
    rec[field] = list.length > TOP_MAX ? list.slice(0, TOP_KEEP) : list;
    await s.set("top", JSON.stringify(rec));
  } catch (e) {
    console.error("Stats top-list tracking failed:", e.message);
  }
}

const queryLabel = (raw) => String(raw || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
const bookLabel = (book) => [book.title, book.author].filter(Boolean).join(" — ").slice(0, 100);

// ---------------------------------------------------------------- reading

async function getReport(event) {
  const s = store(event);
  const now = new Date();
  const days = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now.getTime() - i * DAY_MS)));
  const [total, top, ...dayRecs] = await Promise.all([
    readJson(s, "total", {}),
    readJson(s, "top", {}),
    ...days.map((k) => readJson(s, `day:${k}`, {})),
  ]);
  const sum = (recs) =>
    recs.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r)) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {});
  return {
    now,
    total,
    top,
    today: dayRecs[0],
    yesterday: dayRecs[1],
    week: sum(dayRecs.slice(0, 7)),
    month: sum(dayRecs),
  };
}

// ---------------------------------------------------------------- formatting (English, plain text)

const f = (n) => Number(n || 0).toLocaleString("en-US");
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function block(title, c) {
  const n = (k) => Number(c[k] || 0);
  const lines = [title];

  let search = `🔎 Searches: ${f(n("search"))} (found ${f(n("searchHit"))} · no results ${f(n("searchMiss"))}`;
  if (n("searchDown")) search += ` · sources down ${f(n("searchDown"))}`;
  lines.push(search + ")");

  lines.push(`📥 Files sent: ${f(n("dl"))} (PDF ${f(n("dlPdf"))} · EPUB ${f(n("dlEpub"))})`);
  if (n("dl")) {
    lines.push(`   ↳ free ${f(n("dlFree"))} · paid credit ${f(n("dlCredit"))} · exempt from quota ${f(n("dlExempt"))}`);
  }
  if (n("paywall")) lines.push(`🔒 Reached the paywall: ${f(n("paywall"))}`);
  if (n("dlFail")) {
    lines.push(`⚠️ Delivery failures: ${f(n("dlFail"))} (too large ${f(n("dlTooLarge"))} · not a valid book ${f(n("dlNotBook"))} · errors ${f(n("dlError"))})`);
  }

  if (n("cmtReply") || n("cmtCmd")) {
    lines.push(`💬 Comment invites: ${f(n("cmtReply"))} · /book in comments: ${f(n("cmtCmd"))}`);
  }
  if (n("startCmt") || n("startPost")) {
    lines.push(`🚀 Bot opened from: comments ${f(n("startCmt"))} · post buttons ${f(n("startPost"))}`);
  }

  let money = `💰 Sales: ${f(n("stars"))}⭐ from ${f(n("pay"))} ${n("pay") === 1 ? "purchase" : "purchases"}`;
  if (n("refund")) money += ` · refunded ${f(n("refundStars"))}⭐ (${f(n("refund"))}) · net ${f(n("stars") - n("refundStars"))}⭐`;
  lines.push(money);
  return lines.join("\n");
}

function formatReport(r) {
  const t = r.total || {};
  const out = [
    "📊 Bot statistics",
    `🕒 ${r.now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "👥 Users",
    `• Total: ${f(t.newUsers)}`,
    `• New: today ${f(r.today.newUsers)} · 7 days ${f(r.week.newUsers)} · 30 days ${f(r.month.newUsers)}`,
    `• Active: today ${f(r.today.active)} · yesterday ${f(r.yesterday.active)}`,
    "",
    block("📅 Today", r.today),
    "",
    block("🗓 Last 7 days", r.week),
    "",
    block("📆 Last 30 days", r.month),
    "",
    block("♾ All time", t),
    "",
    `ℹ️ Counting since ${t.since || "—"} (UTC).`,
    "/stats top → most requested",
  ];
  return out.join("\n");
}

function list(title, rows, limit = 10) {
  const items = (rows || []).slice(0, limit);
  if (!items.length) return `${title}\n— no data yet`;
  return [title, ...items.map(([label, count], i) => `${i + 1}. ${short(String(label), 60)} (${f(count)})`)].join("\n");
}

function formatTop(r) {
  const top = r.top || {};
  const bySource = Object.entries(r.month)
    .filter(([k]) => k.startsWith("src:"))
    .map(([k, v]) => [k.slice(4), v])
    .sort((a, b) => b[1] - a[1]);
  return [
    "🏆 Most requested",
    "",
    list("📥 Most downloaded books", top.books),
    "",
    list("🔎 Most frequent searches", top.queries),
    "",
    list("🕳 Searches with no results (gaps in the sources)", top.misses),
    "",
    list("📚 Files sent by source (30 days)", bySource),
    "",
    "/stats → summary",
  ].join("\n");
}

module.exports = { dayKey, track, touchUser, bumpTop, queryLabel, bookLabel, getReport, formatReport, formatTop };
