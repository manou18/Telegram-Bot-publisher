const { SOURCES } = require("../lib/sources");
const { scheduleBook } = require("../lib/scheduledBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, fileType, publishCoverOnlyIfNoFile, category, scheduledFor } =
      JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

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
    // publish, including a fresh download-URL lookup, happens later from the stored item.
    const book = await source.buildBook(item);
    const ratingNum = typeof book.source_rating === "number" ? book.source_rating : null;

    const record = await scheduleBook(event, {
      sourceId,
      item,
      title: book.title,
      author: book.author,
      cover_url: book.cover_url || null,
      source: book.source,
      category: category || null,
      rating: ratingNum,
      fileType: fileType || null,
      publishCoverOnlyIfNoFile: !!publishCoverOnlyIfNoFile,
      scheduledFor: target.toISOString(),
    });

    return { statusCode: 200, body: JSON.stringify({ status: "scheduled", record }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
