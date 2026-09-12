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

async function scheduleBook(event, { sourceId, item, title, author, cover_url, coverIsCustom, source, category, rating, fileType, publishCoverOnlyIfNoFile, scheduledFor, description, channels }) {
  const store = getScheduledStore(event);
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
    // Which Telegram channel(s) (by id, see lib/channels.js) the publisher picked at
    // schedule time — carried forward and used verbatim when the cron publishes this
    // later. Empty/omitted falls back to the category/default resolution in
    // lib/channels.js when the cron actually sends it.
    channels: Array.isArray(channels) ? channels : [],
    rating: rating || null,
    // User-edited or AI-rewritten description from the preview screen, if any — used
    // instead of the raw source description when the cron job publishes this later (see
    // scheduled-publish.js). Rebuilt-fresh fields like the download URL still come from
    // buildBook() at publish time; only this text snapshot is carried forward early.
    description: typeof description === "string" ? description : null,
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
  // Once a scheduled book is resolved — published OR failed — there's no further use for
  // the raw source item, and for a manually-entered book, "item" (or a custom cover) can
  // be tens of MB of base64 (an uploaded file/cover stored as a data: URI). Keeping that
  // sitting in Netlify Blobs for a record that's now pure history wastes real storage on
  // the free tier for no benefit — the "Scheduled" tab only ever reads title/author/
  // source/rating/status/message/scheduledFor from a resolved record, never item or
  // cover_url (see runScheduled() in public/js/03-browse-search.js), so both are safe to
  // drop here regardless of which way it resolved. ("cancelled" records are deleted
  // outright by cancelScheduled(),
  // not resolved through here, so they never reach this point.)
  if (status === "published" || status === "failed") {
    record.item = null;
    if (record.cover_is_custom) record.cover_url = null;
  }
  await store.set(id, JSON.stringify(record));
  return record;
}

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Deletes scheduled-book records that are no longer pending (published/failed) and were
// resolved over a month ago — by then markScheduledResult() above has already stripped
// the heavy payload from both "published" and "failed" ones, but this clears out the
// small record itself too, and cleans up old ones the user never manually cleared from
// the Scheduled tab. A month is plenty for that history to stay useful without growing
// forever. Never touches "pending" records regardless of age. Returns how many were removed.
async function cleanupOldScheduled(event, maxAgeMs = ONE_MONTH_MS) {
  const store = getScheduledStore(event);
  const all = await listScheduled(event);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  await Promise.all(
    all.map(async (record) => {
      if (record.status === "pending") return;
      const resolvedAt = record.resolvedAt ? new Date(record.resolvedAt).getTime() : null;
      if (resolvedAt && resolvedAt < cutoff) {
        await store.delete(record.id);
        removed++;
      }
    })
  );
  return removed;
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
  cleanupOldScheduled,
  cancelScheduled,
  deleteScheduled,
  restoreScheduled,
  markScheduledResult,
  getDuePending,
};
