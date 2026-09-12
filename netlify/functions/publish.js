const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");
const { checkPublished, recordPublished } = require("../lib/publishLog");
const { checkSaved, unsaveBook } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");
const { buildManualBook, MANUAL_SOURCE_ID } = require("../lib/manualSource");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, publishCoverOnlyIfNoFile, force, fileType, category, customCoverUrl, customDescription, channels } =
      JSON.parse(event.body || "{}");

    let book;
    if (sourceId === MANUAL_SOURCE_ID) {
      if (!item || !item.title) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };
      book = buildManualBook(item);
    } else {
      const source = SOURCES[sourceId];
      if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };
      book = await source.buildBook(item);
    }

    // Effective overrides: whatever this request explicitly sent takes priority (the
    // single-book "Publish" button always sends the live edit state). If it sent neither,
    // fall back to whatever was saved for this book — this is what makes bulk-publishing
    // from the Saved tab (which only sends source/item/category, no edits) actually use
    // the custom cover/description instead of silently reverting to the source's own.
    let effectiveCoverUrl = customCoverUrl || null;
    let effectiveDescription = typeof customDescription === "string" ? customDescription : undefined;
    if (!effectiveCoverUrl || effectiveDescription === undefined) {
      try {
        const saved = await checkSaved(event, sourceId, item);
        if (saved) {
          if (!effectiveCoverUrl && saved.cover_is_custom && saved.cover_url) {
            effectiveCoverUrl = saved.cover_url;
          }
          if (effectiveDescription === undefined && typeof saved.description === "string") {
            effectiveDescription = saved.description;
          }
        }
      } catch (e) {
        console.error("Failed to check the saved-books store:", e.message);
      }
    }

    // Manually supplied cover (uploaded file as a data: URI, or a pasted image URL) takes
    // priority over whatever the source fetched, when the user picked "Custom cover" in the UI.
    if (effectiveCoverUrl) {
      book.cover_url = effectiveCoverUrl;
    }
    // User-edited or AI-rewritten description from the preview screen takes priority over
    // whatever the source's raw metadata had — this is exactly the fix for long/inaccurate
    // source descriptions getting blindly chopped by telegram.js's truncate().
    if (typeof effectiveDescription === "string") {
      book.description = effectiveDescription.trim() || null;
    }
    // No manual rating step: when the source itself provides a real reader rating (Open
    // Library / Google Books, when readers have actually rated that book there), use it.
    // Every other source — and books on OL/Google Books with no reader ratings — publish
    // with no rating at all rather than blocking on one.
    book.rating = typeof book.source_rating === "number" ? book.source_rating : null;
    // Which category the user was browsing when they picked this book (if any) — purely
    // for the "most active by category" stats breakdown, not used for anything functional.
    book.category = category || null;

    // If the book is available in both formats (PDF and EPUB) and the user specified
    // which one to publish from the UI, we swap download_url to the requested format before sending.
    if (fileType === "pdf" && book.download_url_pdf) {
      book.download_url = book.download_url_pdf;
    } else if (fileType === "epub" && book.download_url_epub) {
      book.download_url = book.download_url_epub;
    }

    // Duplicate check — protects even if this endpoint is called directly without going through
    // the UI, unless force:true is sent (after the user sees the warning and confirms publishing).
    if (!force) {
      let alreadyPublished = null;
      try {
        alreadyPublished = await checkPublished(event, sourceId, item);
      } catch (e) {
        console.error("Failed to check the publish log:", e.message);
      }
      if (alreadyPublished) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            book,
            status: "duplicate",
            already_published: true,
            published_at: alreadyPublished.publishedAt,
            message: `⚠️ This book was already published. Click Publish again to confirm if you want to republish it.`,
          }),
        };
      }
    }

    const result = await sendBook(book, !!publishCoverOnlyIfNoFile, channels);

    try {
      await recordPublished(event, sourceId, item, book, result.posts);
    } catch (e) {
      console.error("Failed to record the book in the publish log:", e.message);
    }

    // Once published it no longer needs to sit in the "save for later" list — best-effort,
    // and harmless if it was never saved to begin with.
    try {
      await unsaveBook(event, sourceId, item);
    } catch (e) {
      console.error("Failed to remove the book from the saved list:", e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ book, ...result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
