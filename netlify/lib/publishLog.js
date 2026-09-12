// Records every book that actually gets published so we can warn the user if they try to
// publish the same book again. We use Netlify Blobs because it's the only storage available
// to Netlify functions that persists between calls (unlike regular memory, which is cleared
// on each separate function invocation).

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { getStableId } = require("./bookIdentity");

// Keyed on the stable per-source identity (see bookIdentity.js), not on the download URL —
// the same book shouldn't be treated as "different" just because the user picked EPUB
// instead of PDF this time.
function keyFor(sourceId, item) {
  return crypto.createHash("sha256").update(getStableId(sourceId, item)).digest("hex");
}

function getPublishStore(event) {
  connectLambda(event);
  return getStore("published-books");
}

async function checkPublished(event, sourceId, item) {
  const store = getPublishStore(event);
  const raw = await store.get(keyFor(sourceId, item));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function recordPublished(event, sourceId, item, book, posts) {
  const store = getPublishStore(event);
  await store.set(
    keyFor(sourceId, item),
    JSON.stringify({
      title: book.title,
      author: book.author,
      source: book.source,
      category: book.category || null,
      rating: book.rating || null,
      // Kept alongside the summary fields above (not just for /api/stats) so /api/feed
      // can build a real RSS/Atom item — full description, cover, and a link to the
      // book itself — straight from this store, without re-fetching anything from the
      // original source. Older records predating this simply won't have them (feed.js
      // treats them as optional and falls back gracefully).
      description: book.description || null,
      cover_url: book.cover_url || null,
      download_url: book.download_url || null,
      // One entry per channel this book was actually posted to (see sendBook() in
      // telegram.js) — { chatId, messageId, views, viewsUpdatedAt }. views/viewsUpdatedAt
      // start out empty and get filled in later by the refresh-views cron job, since
      // Telegram doesn't hand over a view count at publish time (a post has 0 views the
      // instant it's sent — see lib/telegramViews.js for how/why views are fetched
      // separately, after the fact). Older records predating this feature simply have no
      // `posts` array, which every reader here treats as "no views to show" rather than
      // an error.
      posts: Array.isArray(posts)
        ? posts.map((p) => ({ chatId: p.chatId, messageId: p.messageId, views: null, viewsUpdatedAt: null }))
        : [],
      publishedAt: new Date().toISOString(),
    })
  );
}

// Returns a Map of (the same hash keyFor() produces) -> rating, for every previously
// published book that has one. Used to rank already-rated books first when browsing or
// searching, so a book you rated highly before surfaces at the top if you come across it
// again — callers hash each candidate item with keyForBook and look it up here.
async function getRatingsMap(event) {
  const store = getPublishStore(event);
  const map = new Map();
  const { blobs } = await store.list();
  await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return;
      try {
        const record = JSON.parse(raw);
        if (record.rating) map.set(key, record.rating);
      } catch {
        // ignore malformed entries
      }
    })
  );
  return map;
}

// Updates just the rating on an already-published record, without touching Telegram —
// for correcting/changing your mind about a rating after the fact. Returns null if the
// book was never published (nothing to update).
async function updatePublishedRating(event, sourceId, item, rating) {
  const store = getPublishStore(event);
  const key = keyFor(sourceId, item);
  const raw = await store.get(key);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  record.rating = rating;
  await store.set(key, JSON.stringify(record));
  return record;
}

// Returns every published record as a flat array — used by /api/stats to compute totals,
// averages, and breakdowns. Order isn't guaranteed; callers sort as needed.
// Returns every published record as a flat array — used by /api/stats to compute totals,
// averages, and breakdowns, and by /api/export for backups. Each record includes its own
// store key (added here) so /api/import can restore it into the exact same slot later —
// checkPublished()/getRatingsMap() look records up by that same hash, not by anything in
// the record's own fields, so without it a restored record could never be matched again.
async function listPublished(event) {
  const store = getPublishStore(event);
  const { blobs } = await store.list();
  const records = await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return null;
      try {
        return { key, ...JSON.parse(raw) };
      } catch {
        return null;
      }
    })
  );
  return records.filter(Boolean);
}

// Restores one previously-exported published-book record (as produced by listPublished
// above, including its key) back into the store. Skips — rather than overwrites — a
// record that's already present, so importing an old backup can never clobber something
// published more recently. Returns "imported" | "skipped" | "invalid".
async function restorePublished(event, record) {
  if (!record || !record.key || !record.title) return "invalid";
  const store = getPublishStore(event);
  const existing = await store.get(record.key);
  if (existing) return "skipped";
  const { key, ...rest } = record;
  await store.set(key, JSON.stringify(rest));
  return "imported";
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Deletes published-book history older than one year. NOT currently called from anywhere
// (the cleanup.js cron job deliberately leaves this store alone — see its comment for
// why: these records are tiny and the whole point of this store is a long-lived
// duplicate-publish warning, not something that should expire). Left here in case a
// different retention policy is ever wanted later.
async function cleanupOldPublished(event, maxAgeMs = ONE_YEAR_MS) {
  const store = getPublishStore(event);
  const { blobs } = await store.list();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return;
      try {
        const record = JSON.parse(raw);
        if (record.publishedAt && new Date(record.publishedAt).getTime() < cutoff) {
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

// Sum of views across every channel a book was posted to — the number /api/stats and
// /api/feed show as "this book's views". Records from before this feature (no `posts`
// array) simply contribute 0, not an error.
function getTotalViews(record) {
  if (!record || !Array.isArray(record.posts)) return 0;
  return record.posts.reduce((sum, p) => sum + (typeof p.views === "number" ? p.views : 0), 0);
}

// Called by the refresh-views cron job after it fetches a fresh view count for one
// specific channel post (see lib/telegramViews.js). Matched by chatId+messageId rather
// than array index, since posts is a plain array and order isn't guaranteed to be stable.
async function updatePostViews(event, key, chatId, messageId, views) {
  const store = getPublishStore(event);
  const raw = await store.get(key);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(record.posts)) return null;
  const post = record.posts.find((p) => p.chatId === chatId && p.messageId === messageId);
  if (!post) return null;
  post.views = views;
  post.viewsUpdatedAt = new Date().toISOString();
  await store.set(key, JSON.stringify(record));
  return record;
}

// Every individual channel-post the refresh-views cron could check, oldest-refreshed (or
// never-refreshed) first, capped at `limit` — so a single 5-minute cron tick only ever
// touches a small, rate-limit-friendly batch, and every post eventually gets its turn
// rather than the same handful being refreshed over and over while others are starved.
async function listPostsNeedingViewsRefresh(event, limit) {
  const records = await listPublished(event);
  const tasks = [];
  records.forEach((record) => {
    (record.posts || []).forEach((post) => {
      if (!post.chatId || !post.messageId) return;
      tasks.push({
        key: record.key,
        chatId: post.chatId,
        messageId: post.messageId,
        viewsUpdatedAt: post.viewsUpdatedAt || null,
      });
    });
  });
  tasks.sort((a, b) => new Date(a.viewsUpdatedAt || 0) - new Date(b.viewsUpdatedAt || 0));
  return tasks.slice(0, limit);
}

module.exports = {
  checkPublished,
  recordPublished,
  getRatingsMap,
  updatePublishedRating,
  listPublished,
  restorePublished,
  cleanupOldPublished,
  getTotalViews,
  updatePostViews,
  listPostsNeedingViewsRefresh,
  keyForBook: keyFor,
};
