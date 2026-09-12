const { SOURCES } = require("../lib/sources");
const { scheduleBook } = require("../lib/scheduledBooks");
const { requireAuth } = require("../lib/auth");
const { buildManualBook, MANUAL_SOURCE_ID } = require("../lib/manualSource");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, fileType, publishCoverOnlyIfNoFile, category, scheduledFor, customDescription, customCoverUrl, channels } =
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

    if (!scheduledFor) {
      return { statusCode: 400, body: JSON.stringify({ error: "Please choose a date and time to schedule for." }) };
    }
    const target = new Date(scheduledFor);
    if (isNaN(target.getTime())) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid date/time." }) };
    }
    if (target.getTime() <= Date.now()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Please choose a time in the future." }) };
    }

    // Build the book now purely for a display snapshot (title/author/cover) — the actual
    // publish, including a fresh download-URL lookup, happens later from the stored item
    // (for a manual entry there's nothing to re-fetch, so the snapshot IS the final data).
    const ratingNum = typeof book.source_rating === "number" ? book.source_rating : null;

    const record = await scheduleBook(event, {
      sourceId,
      item,
      title: book.title,
      author: book.author,
      cover_url: customCoverUrl || book.cover_url || null,
      coverIsCustom: !!customCoverUrl,
      source: book.source,
      category: category || null,
      rating: ratingNum,
      fileType: fileType || null,
      publishCoverOnlyIfNoFile: !!publishCoverOnlyIfNoFile,
      scheduledFor: target.toISOString(),
      description: customDescription,
      channels,
    });

    return { statusCode: 200, body: JSON.stringify({ status: "scheduled", record }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
