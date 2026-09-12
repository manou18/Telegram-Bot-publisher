// A small cache layer for the JSON responses behind Browse/Search list requests (category
// pages and search-query pages) — the most-repeated requests in this app, since browsing
// tends to revisit the same handful of categories and paginate back and forth. Stored in
// its own Netlify Blobs store ("http-cache"), separate from every other store here, keyed
// by a hash of the exact request URL.
//
// Two things this buys us:
//  1. Speed — a repeat hit for a URL fetched recently skips the network call entirely.
//  2. Resilience — Gutendex in particular sits behind Cloudflare protection that's known to
//     intermittently reject requests (see fetchJson's own retry-with-backoff in sources.js)
//     even after three attempts. If the live fetch ultimately fails but a reasonably recent
//     cached copy of that same URL exists, we serve the stale copy instead of surfacing an
//     error — a slightly-out-of-date book list beats none at all.
//
// Deliberately NOT used for buildBook() detail lookups (download links, descriptions) —
// those are opened one at a time right before a publish decision, so they're both less
// repeated and more worth always being fresh.

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const FRESH_MS = 10 * 60 * 1000; // serve straight from cache within this window, no network call
const STALE_MAX_MS = 6 * 60 * 60 * 1000; // beyond this, a failed live fetch surfaces a real error instead of ancient data

function cacheKey(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function getCacheStore(event) {
  connectLambda(event);
  return getStore("http-cache");
}

// fetcher: an async (url) => data function — pass fetchJson from sources.js. Returns
// whatever fetcher resolves to: straight from cache when fresh, otherwise from a live
// call, falling back to a not-too-old cached copy if the live call throws.
async function cachedFetchJson(event, url, fetcher) {
  const store = getCacheStore(event);
  const key = cacheKey(url);
  const now = Date.now();

  let cached = null;
  try {
    const raw = await store.get(key);
    if (raw) cached = JSON.parse(raw);
  } catch (e) {
    console.error("http-cache read failed:", e.message);
  }

  if (cached && now - cached.fetchedAt < FRESH_MS) {
    return cached.data;
  }

  try {
    const data = await fetcher(url);
    try {
      await store.set(key, JSON.stringify({ fetchedAt: now, data }));
    } catch (e) {
      console.error("http-cache write failed:", e.message);
    }
    return data;
  } catch (e) {
    if (cached && now - cached.fetchedAt < STALE_MAX_MS) {
      console.error(
        `Live fetch failed for ${url}, serving cached copy from ${new Date(cached.fetchedAt).toISOString()} instead:`,
        e.message
      );
      return cached.data;
    }
    throw e;
  }
}

// http-cache entries are only ever useful within STALE_MAX_MS (a few hours) — anything
// older than that is dead weight that a plain store.set() never reclaims on its own,
// since every distinct search/browse URL ever requested gets its own permanent key
// otherwise. Run this periodically to actually free that space; a much shorter window
// than the one-year history retention used elsewhere, since nothing in this store is
// meant to live more than a few hours in the first place. Returns how many were removed.
const CACHE_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // a day of headroom past STALE_MAX_MS

async function cleanupOldCache(event, maxAgeMs = CACHE_CLEANUP_AGE_MS) {
  const store = getCacheStore(event);
  const { blobs } = await store.list();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return;
      try {
        const cached = JSON.parse(raw);
        if (cached.fetchedAt && cached.fetchedAt < cutoff) {
          await store.delete(key);
          removed++;
        }
      } catch {
        // malformed entry — leave it, not this function's job to guess at it
      }
    })
  );
  return removed;
}

module.exports = { cachedFetchJson, cleanupOldCache };
