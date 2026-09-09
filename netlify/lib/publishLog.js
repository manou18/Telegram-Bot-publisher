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

async function recordPublished(event, sourceId, item, book) {
  const store = getPublishStore(event);
  await store.set(
    keyFor(sourceId, item),
    JSON.stringify({
      title: book.title,
      author: book.author,
      source: book.source,
      category: book.category || null,
      rating: book.rating || null,
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

module.exports = {
  checkPublished,
  recordPublished,
  getRatingsMap,
  updatePublishedRating,
  listPublished,
  restorePublished,
  keyForBook: keyFor,
};
