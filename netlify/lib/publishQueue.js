// A persistent "drip-feed" publish queue: an ordered list of books that get published one
// at a time, spaced out automatically by the scheduled-publish cron (every 5 minutes, see
// netlify.toml) according to an adjustable interval.
//
// This is deliberately a different thing from scheduledBooks.js:
//   - scheduledBooks.js  = "publish THIS book at THIS exact date/time", one-off, per book.
//   - publishQueue.js    = "publish books from this list automatically, one every X
//                           minutes/hours/days, for as long as the queue has items in it" —
//                           it never runs out on its own the way a one-off schedule does;
//                           it just idles (nothing due) once empty, and picks back up the
//                           moment something new is added.
//
// Two Netlify Blobs stores:
//   "publish-queue"          — the ordered items themselves (one blob key per item, same
//                               pattern as scheduledBooks.js, so concurrent adds can't
//                               clobber each other).
//   "publish-queue-settings" — a single record: whether the drip-feed is enabled, how many
//                               minutes should separate consecutive publishes, and when the
//                               last one actually went out (so the cron knows whether the
//                               next one is due yet).

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { getStableId } = require("./bookIdentity");

function getQueueStore(event) {
  connectLambda(event);
  return getStore("publish-queue");
}

function getSettingsStore(event) {
  connectLambda(event);
  return getStore("publish-queue-settings");
}

const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 60, // how far apart consecutive drip-feed publishes should land
  lastPublishedAt: null, // ISO string — updated by the cron every time it drains one item
};

// A queue item that fails this many times in a row is marked "stuck" instead of being
// retried forever — see markQueueAttemptFailed() below.
const MAX_ATTEMPTS = 3;

async function getQueueSettings(event) {
  const store = getSettingsStore(event);
  const raw = await store.get(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveQueueSettings(event, patch) {
  const store = getSettingsStore(event);
  const current = await getQueueSettings(event);
  const next = { ...current, ...patch };
  await store.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// Items are ordered by a monotonically increasing "position" (Date.now() at insertion
// time, tie-broken by id), not by array index in a single blob — that way two adds
// happening close together can't race and overwrite each other, exactly like
// scheduledBooks.js's per-item-blob approach.
async function addToQueue(
  event,
  { sourceId, item, title, author, cover_url, coverIsCustom, source, category, rating, fileType, publishCoverOnlyIfNoFile, description, channels }
) {
  const store = getQueueStore(event);
  const id = crypto.randomUUID();
  const record = {
    id,
    sourceId,
    item,
    title,
    author,
    cover_url: cover_url || null,
    cover_is_custom: !!coverIsCustom,
    source,
    category: category || null,
    // Which Telegram channel(s) (by id, see lib/channels.js) the publisher picked when
    // queuing this book — carried forward and used verbatim when the cron drains it, same
    // treatment as description/cover below. Empty/omitted falls back to the category/
    // default resolution in lib/channels.js at publish time.
    channels: Array.isArray(channels) ? channels : [],
    rating: rating || null,
    description: typeof description === "string" ? description : null,
    fileType: fileType || null,
    publishCoverOnlyIfNoFile: !!publishCoverOnlyIfNoFile,
    addedAt: new Date().toISOString(),
    position: Date.now(),
    status: "pending", // "pending" | "stuck" — see markQueueAttemptFailed()
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
  await store.set(id, JSON.stringify(record));
  return record;
}

async function listQueue(event) {
  const store = getQueueStore(event);
  const { blobs } = await store.list();
  const records = await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
  );
  return records
    .filter(Boolean)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

async function removeFromQueue(event, id) {
  const store = getQueueStore(event);
  const raw = await store.get(id);
  if (!raw) return null;
  await store.delete(id);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Fetches a single queue item by id without removing it — used by the "Publish now"
// action (see queue-publish-now.js), which needs to act on one specific item regardless
// of its position in the queue, unlike peekNext() which only ever looks at the head.
async function getQueueItem(event, id) {
  const store = getQueueStore(event);
  const raw = await store.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Moves one item earlier/later by swapping its "position" with its immediate neighbor in
// that direction — touches at most 2 records and leaves everyone else's order untouched.
// Superseded in the UI by drag-and-drop (see reorderQueueByIds() below), kept here as a
// simple, still-supported way to nudge one item by exactly one place.
async function reorderQueueItem(event, id, direction) {
  const all = await listQueue(event);
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return all;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return all; // already at an edge, no-op

  const store = getQueueStore(event);
  const a = all[idx];
  const b = all[swapIdx];
  const aPos = a.position;
  a.position = b.position;
  b.position = aPos;
  await store.set(a.id, JSON.stringify(a));
  await store.set(b.id, JSON.stringify(b));
  return listQueue(event);
}

// Applies an arbitrary new order in one shot — used by the drag-and-drop reordering in
// the Publish Queue tab, where the user can drop an item anywhere in the list, not just
// swap it with its immediate neighbor. `orderedIds` must be the full, current set of
// queue item ids in their desired final order; each item's "position" is rewritten to
// its index in that array, so their relative order matches it exactly (a later addToQueue()
// call still lands after all of these — see the DEFAULT position comment above — because
// Date.now() is astronomically larger than any of these small integer positions).
// Ignores unknown ids and leaves out-of-sync ones untouched rather than failing outright,
// since the list the browser sent may have gone stale by a few seconds (item removed,
// drained by the cron, etc).
async function reorderQueueByIds(event, orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return listQueue(event);
  const store = getQueueStore(event);
  const all = await listQueue(event);
  const byId = new Map(all.map((r) => [r.id, r]));

  let index = 0;
  for (const id of orderedIds) {
    const record = byId.get(id);
    if (!record) continue; // stale id (removed/published since the browser last fetched) — skip it
    if (record.position !== index) {
      record.position = index;
      await store.set(record.id, JSON.stringify(record));
    }
    index += 1;
  }
  return listQueue(event);
}

// Returns the oldest queued item (FIFO) WITHOUT deleting it — the caller (the cron in
// scheduled-publish.js) only removes it after actually publishing successfully, so a
// mid-publish crash leaves the book still queued (and first in line) instead of lost.
//
// Items marked "stuck" (see markQueueAttemptFailed()) are skipped: a book that keeps
// failing (dead link, oversized file...) no longer blocks everything queued behind it —
// it just sits there showing "stuck" in the UI until the user removes it or retries it
// manually.
async function peekNext(event) {
  const all = await listQueue(event);
  return all.find((r) => r.status !== "stuck") || null;
}

// Records a failed publish attempt for a queue item. After MAX_ATTEMPTS consecutive
// failures the item is marked "stuck" instead of being retried on every future cron tick
// forever — it stays in the queue (so nothing is silently lost) but peekNext() skips over
// it, so the rest of the queue keeps draining normally.
async function markQueueAttemptFailed(event, id, errorMessage) {
  const store = getQueueStore(event);
  const raw = await store.get(id);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  record.attempts = (record.attempts || 0) + 1;
  record.lastError = errorMessage || "Unknown error";
  record.lastAttemptAt = new Date().toISOString();
  record.status = record.attempts >= MAX_ATTEMPTS ? "stuck" : "pending";
  await store.set(id, JSON.stringify(record));
  return record;
}

// Resets a "stuck" item back to "pending" with a clean attempt counter, so it gets picked
// up by peekNext() again on the next due tick — used by the "retry" action in the UI.
async function retryQueueItem(event, id) {
  const store = getQueueStore(event);
  const raw = await store.get(id);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  record.status = "pending";
  record.attempts = 0;
  record.lastError = null;
  await store.set(id, JSON.stringify(record));
  return record;
}

async function queueLength(event) {
  const all = await listQueue(event);
  return all.length;
}

// Every item currently queued for this exact book — lets /api/queue-add warn/skip "this
// is already queued" the same way checkPublished()/checkScheduled() do for their own
// lists, using the same stable book identity (bookIdentity.js) so all three agree on what
// "the same book" means. Queue items are keyed by a random id (not by book identity), so
// in principle the same book could be queued more than once — this scans and matches on
// identity rather than a single get(), same approach scheduledBooks.js uses.
async function checkQueued(event, sourceId, item) {
  const target = getStableId(String(sourceId), item);
  const all = await listQueue(event);
  return all.filter((r) => getStableId(String(r.sourceId), r.item) === target);
}

// Restores one previously-exported queue record (as produced by listQueue, which already
// includes its own id) back into the store — same "skip, don't overwrite" behavior as
// scheduledBooks.js's restoreScheduled(), so importing an old backup can't duplicate or
// clobber an item queued since it was taken. Returns "imported" | "skipped" | "invalid".
async function restoreQueueItem(event, record) {
  if (!record || !record.id || !record.item) return "invalid";
  const store = getQueueStore(event);
  const existing = await store.get(record.id);
  if (existing) return "skipped";
  await store.set(record.id, JSON.stringify(record));
  return "imported";
}

module.exports = {
  getQueueSettings,
  saveQueueSettings,
  addToQueue,
  listQueue,
  removeFromQueue,
  getQueueItem,
  reorderQueueItem,
  reorderQueueByIds,
  peekNext,
  queueLength,
  checkQueued,
  restoreQueueItem,
  markQueueAttemptFailed,
  retryQueueItem,
  MAX_ATTEMPTS,
};
