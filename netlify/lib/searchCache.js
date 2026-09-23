// Caches searchBooks() results ACROSS ALL USERS for the same normalized query, so repeated
// searches for the same book (a handful of popular titles usually account for a large share of
// traffic) skip hitting every source again. This is separate from botSession.js, which only
// remembers one chat's *own* last results (for resolving a button tap) — this cache is shared.
//
// Netlify Blobs, not an in-memory Map, because a serverless function may run on a different
// instance on every invocation and can't rely on memory surviving between calls (same pattern
// used everywhere else in this project — see bot-sessions, bot-stats, bot-accounts...).

const { connectLambda, getStore } = require("@netlify/blobs");

function store(event) {
  connectLambda(event);
  return getStore("bot-search-cache");
}

// SEARCH_CACHE_TTL_HOURS (optional env var): how long a cached result set stays valid. Default
// 12h — long enough that a burst of the same request (a book someone just shared a link to, a
// title trending in a group) is served from cache, short enough that a source coming back online
// or a book disappearing is noticed the same day. Set to 0 to disable caching entirely.
function ttlMs() {
  const h = Number(process.env.SEARCH_CACHE_TTL_HOURS);
  return (Number.isFinite(h) && h >= 0 ? h : 12) * 60 * 60 * 1000;
}

// Returns the cached { results, failedSources, approximate } for this key, or null on a miss/
// expiry/error. A cache read failure is treated exactly like a miss — it must never be the
// reason a search fails.
async function getCachedSearch(event, key) {
  if (ttlMs() <= 0) return null;
  try {
    const raw = await store(event).get(`s:${key}`);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return Date.now() - rec.at < ttlMs() ? rec.value : null;
  } catch (e) {
    console.error("Search cache read failed (treating as a miss):", e.message);
    return null;
  }
}

// Best-effort write — a failure here should never break the search that's already succeeded.
async function setCachedSearch(event, key, value) {
  if (ttlMs() <= 0) return;
  try {
    await store(event).set(`s:${key}`, JSON.stringify({ at: Date.now(), value }));
  } catch (e) {
    console.error("Search cache write failed (continuing without caching this result):", e.message);
  }
}

module.exports = { getCachedSearch, setCachedSearch };
