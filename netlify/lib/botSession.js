// Tiny per-chat state for the interactive bot, kept in Netlify Blobs (same pattern as the
// rest of this project — serverless functions can't keep anything in memory between calls).
//  - the last search results, so a button tap ("2 · PDF") can be resolved to a download link
//  - simple rate limiting, because a public bot can otherwise be used to hammer the sources

const { connectLambda, getStore } = require("@netlify/blobs");

const RESULTS_TTL_MS = 24 * 60 * 60 * 1000;

function store(event) {
  connectLambda(event);
  return getStore("bot-sessions");
}

async function saveResults(event, chatId, query, results) {
  await store(event).set(`res:${chatId}`, JSON.stringify({ at: Date.now(), query, results }));
}

async function loadResults(event, chatId) {
  const raw = await store(event).get(`res:${chatId}`);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return Date.now() - rec.at < RESULTS_TTL_MS ? rec : null;
  } catch {
    return null;
  }
}

// Sliding window: at most `max` hits per `windowMs`, and at least `minGapMs` between hits.
// Returns { ok: true } or { ok: false, retryAfterSec }.
async function hit(event, bucket, chatId, { max, windowMs, minGapMs }) {
  const s = store(event);
  const key = `rl:${bucket}:${chatId}`;
  const now = Date.now();
  let hits = [];
  try {
    const raw = await s.get(key);
    if (raw) hits = JSON.parse(raw).filter((t) => now - t < windowMs);
  } catch {
    hits = [];
  }
  if (hits.length && now - hits[hits.length - 1] < minGapMs) {
    return { ok: false, retryAfterSec: Math.ceil((minGapMs - (now - hits[hits.length - 1])) / 1000) };
  }
  if (hits.length >= max) {
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  await s.set(key, JSON.stringify(hits));
  return { ok: true };
}

const searchLimit = (event, chatId) => hit(event, "search", chatId, { max: 12, windowMs: 60 * 60 * 1000, minGapMs: 4000 });
const downloadLimit = (event, chatId) => hit(event, "dl", chatId, { max: 20, windowMs: 60 * 60 * 1000, minGapMs: 2000 });

// When the paywall interrupts a download we remember which book/format was requested, so it can
// be delivered automatically as soon as the payment goes through.
const PENDING_TTL_MS = 60 * 60 * 1000;

async function setPending(event, chatId, idx, format) {
  const rec = await loadResults(event, chatId);
  if (!rec) return;
  rec.pending = { idx, format, at: Date.now() };
  await store(event).set(`res:${chatId}`, JSON.stringify(rec));
}

async function takePending(event, chatId) {
  const rec = await loadResults(event, chatId);
  if (!rec || !rec.pending || Date.now() - rec.pending.at > PENDING_TTL_MS) return null;
  const book = rec.results[rec.pending.idx];
  const format = rec.pending.format;
  delete rec.pending;
  await store(event).set(`res:${chatId}`, JSON.stringify(rec));
  return book ? { book, format } : null;
}

module.exports = { saveResults, loadResults, searchLimit, downloadLimit, setPending, takePending };
