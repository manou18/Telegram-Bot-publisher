// Lets the user bookmark a book while browsing ("save for later") without publishing
// it right away, then come back to a dedicated "Saved" list later to review and publish
// it whenever they decide it's worth posting. Uses the same Netlify Blobs mechanism as
// publishLog.js, but in its own store so saved books and the published-books log never mix.

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const { getStableId } = require("./bookIdentity");

// Keyed on a stable per-source identity (see bookIdentity.js) rather than the raw item's
// full JSON, since two fetches of "the same" search result aren't always byte-identical.
function keyFor(sourceId, item) {
  return crypto.createHash("sha256").update(getStableId(sourceId, item)).digest("hex");
}

function getSavedStore(event) {
  connectLambda(event);
  return getStore("saved-books");
}

async function checkSaved(event, sourceId, item) {
  const store = getSavedStore(event);
  const raw = await store.get(keyFor(sourceId, item));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// `book` here is the already-built book (from source.buildBook), so we can store a small
// display snapshot (title/author/cover/source label/reader rating) without having to
// rebuild it every time the saved list is loaded. `rating` is optional and no longer set
// by the UI (kept for direct API callers); `source_rating` is the book's real reader
// rating pulled from its source, when one exists. `description` is optional — a
// user-edited or AI-rewritten description from the preview screen, kept alongside the
// snapshot so it survives the trip through "Saved" and is used instead of the raw source
// description when this book is eventually published (see preview.js and publish.js).
// `customCoverUrl` is the same idea for a manually-uploaded/pasted cover (data: URI or
// URL) chosen on the preview screen — without storing it here, "save for later" used to
// silently drop the custom cover and fall back to the source's own cover_url once
// re-opened or bulk-published, exactly like the description bug this comment already
// describes.
async function saveBook(event, sourceId, item, book, rating, category, description, customCoverUrl) {
  const store = getSavedStore(event);
  const key = keyFor(sourceId, item);
  const record = {
    key,
    sourceId,
    item,
    title: book.title,
    author: book.author,
    cover_url: customCoverUrl || book.cover_url || null,
    cover_is_custom: !!customCoverUrl,
    source: book.source,
    category: category || null,
    rating: rating || null,
    source_rating: typeof book.source_rating === "number" ? book.source_rating : null,
    description: typeof description === "string" ? description : null,
    savedAt: new Date().toISOString(),
  };
  await store.set(key, JSON.stringify(record));
  return record;
}

async function unsaveBook(event, sourceId, item) {
  const store = getSavedStore(event);
  await store.delete(keyFor(sourceId, item));
}

// Restores one previously-exported saved-book record (as produced by listSaved, which
// already includes its own store key) back into the store. Skips — rather than overwrites
// — a record whose key is already present, so importing an old backup can't undo a more
// recent unsave/re-save. Returns "imported" | "skipped" | "invalid".
async function restoreSaved(event, record) {
  if (!record || !record.key || !record.item) return "invalid";
  const store = getSavedStore(event);
  const existing = await store.get(record.key);
  if (existing) return "skipped";
  await store.set(record.key, JSON.stringify(record));
  return "imported";
}

async function listSaved(event) {
  const store = getSavedStore(event);
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
  // Most recently saved first.
  return records
    .filter(Boolean)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

module.exports = { checkSaved, saveBook, unsaveBook, restoreSaved, listSaved };
