const { SOURCES } = require("../lib/sources");
const { checkPublished } = require("../lib/publishLog");
const { checkSaved } = require("../lib/savedBooks");
const { checkScheduled } = require("../lib/scheduledBooks");
const { getRemoteFileSize } = require("../lib/fileSize");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    const book = await source.buildBook(item);

    // Look up sizes for whichever formats are available so the UI can show them before
    // publishing. Done in parallel and best-effort — a host that won't answer stays null
    // and the frontend just shows "size unknown" instead of failing the whole preview.
    const [sizePdf, sizeEpub] = await Promise.all([
      getRemoteFileSize(book.download_url_pdf),
      getRemoteFileSize(book.download_url_epub),
    ]);
    book.file_size_pdf = sizePdf;
    book.file_size_epub = sizeEpub;

    let alreadyPublished = null;
    try {
      alreadyPublished = await checkPublished(event, sourceId, item);
    } catch (e) {
      console.error("Failed to check the publish log:", e.message);
    }
    book.already_published = !!alreadyPublished;
    book.published_at = alreadyPublished ? alreadyPublished.publishedAt : null;
    book.published_rating = alreadyPublished ? alreadyPublished.rating : null;

    let savedRecord = null;
    try {
      savedRecord = await checkSaved(event, sourceId, item);
    } catch (e) {
      console.error("Failed to check the saved-books store:", e.message);
    }
    book.already_saved = !!savedRecord;
    book.saved_at = savedRecord ? savedRecord.savedAt : null;
    book.saved_rating = savedRecord ? savedRecord.rating : null;

    let scheduledRecords = [];
    try {
      scheduledRecords = await checkScheduled(event, sourceId, item);
    } catch (e) {
      console.error("Failed to check the scheduled-books store:", e.message);
    }
    book.already_scheduled = scheduledRecords.length > 0;
    book.scheduled_for = scheduledRecords.length ? scheduledRecords[0].scheduledFor : null;
    book.scheduled_count = scheduledRecords.length;

    // If this book was previously saved or scheduled with a user-edited/AI-rewritten
    // description, surface that instead of the raw source description we just fetched
    // above — otherwise reopening it from the Saved/Scheduled list would silently lose the
    // earlier fix and show the same long/inaccurate original again. Saved takes priority
    // over scheduled (more likely the most recent edit) when a book happens to be both.
    let customDescription = null;
    if (savedRecord && typeof savedRecord.description === "string") {
      customDescription = savedRecord.description;
    } else if (scheduledRecords.length && typeof scheduledRecords[0].description === "string") {
      customDescription = scheduledRecords[0].description;
    }
    if (customDescription !== null) {
      // Note: an intentionally-cleared description is stored as "" and still wins here —
      // it means the user deliberately removed it, not that nothing was ever saved.
      book.description = customDescription;
      book.description_is_custom = true;
    }

    return { statusCode: 200, body: JSON.stringify(book) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
