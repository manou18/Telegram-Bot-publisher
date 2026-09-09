// Lets the user pick a future date/time for a book instead of publishing immediately.
// Records live in their own Netlify Blobs store ("scheduled-books"), separate from the
// publish log and the saved-for-later list. A scheduled record only stores enough to
// rebuild the book at publish time (sourceId + the raw item, exactly like the saved-books
// store does) plus the rating/format the user picked and the target time — the actual
// buildBook()/download-URL lookup happens fresh when the scheduled-publish cron runs, so
// a link that changes between now and then doesn't get baked in early.

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { getStableId } = require("./bookIdentity");

function getScheduledStore(event) {
  connectLambda(event);
  return getStore("scheduled-books");
}

async function scheduleBook(event, { sourceId, item, title, author, cover_url, source, category, rating, fileType, publishCoverOnlyIfNoFile, scheduledFor }) {
  const store = getScheduledStore(event);
  const id = crypto.randomUUID();
  const record = {
    id,
    sourceId,
    item,
    title,
    author,
    cover_url: cover_url || null,
    source,
    category: category || null,
    rating: rating || null,
    fileType: fileType || null,
    publishCoverOnlyIfNoFile: !!publishCoverOnlyIfNoFile,
    scheduledFor,
    status: "pending", // "pending" | "published" | "failed" | "cancelled"
    message: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  await store.set(id, JSON.stringify(record));
  return record;
}

async function listScheduled(event) {
  const store = getScheduledStore(event);
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
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
}

async function getScheduled(event, id) {
  const store = getScheduledStore(event);
  const raw = await store.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Every still-pending scheduled record for this exact book, soonest first — lets the
// preview screen warn "this is already scheduled" the same way already_published/
// already_saved do. Unlike those two stores, scheduled-books is keyed by a random id per
// schedule rather than by book identity (so in principle the same book could be scheduled
// more than once), so this scans the pending list and matches on the same stable identity
// bookIdentity.js uses for the publish log and saved list, rather than a single get().
async function checkScheduled(event, sourceId, item) {
  const target = getStableId(String(sourceId), item);
  const all = await listScheduled(event);
  return all.filter(
    (r) => r.status === "pending" && getStableId(String(r.sourceId), r.item) === target
  );
}

// Only cancels it if it's still pending — once it's published/failed it's history, kept
// around for the "Scheduled" tab (until explicitly cleared) rather than silently removable.
async function cancelScheduled(event, id) {
  const store = getScheduledStore(event);
  const record = await getScheduled(event, id);
  if (!record || record.status !== "pending") return null;
  await store.delete(id);
  return record;
}

async function deleteScheduled(event, id) {
  const store = getScheduledStore(event);
  await store.delete(id);
}

// Restores one previously-exported scheduled-book record (as produced by listScheduled,
// which already includes its own id) back into the store. Skips — rather than overwrites
// — a record whose id already exists, so importing an old backup can't duplicate or
// clobber a schedule made since it was taken. Returns "imported" | "skipped" | "invalid".
async function restoreScheduled(event, record) {
  if (!record || !record.id || !record.item) return "invalid";
  const store = getScheduledStore(event);
  const existing = await store.get(record.id);
  if (existing) return "skipped";
  await store.set(record.id, JSON.stringify(record));
  return "imported";
}

async function markScheduledResult(event, id, status, message) {
  const store = getScheduledStore(event);
  const record = await getScheduled(event, id);
  if (!record) return null;
  record.status = status;
  record.message = message || null;
  record.resolvedAt = new Date().toISOString();
  await store.set(id, JSON.stringify(record));
  return record;
}

// Every still-pending record whose target time has arrived, oldest first — used by the
// scheduled-publish cron so it processes them in the order they were meant to go out.
async function getDuePending(event, nowIso) {
  const all = await listScheduled(event);
  return all.filter((r) => r.status === "pending" && r.scheduledFor <= nowIso);
}

module.exports = {
  scheduleBook,
  listScheduled,
  getScheduled,
  checkScheduled,
  cancelScheduled,
  deleteScheduled,
  restoreScheduled,
  markScheduledResult,
  getDuePending,
};
