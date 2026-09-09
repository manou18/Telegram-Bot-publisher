const { SOURCES } = require("../lib/sources");
const { saveBook } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, rating, category } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    // The rating is optional here (unlike /api/publish) — you can save a book to look at
    // later without having decided on a rating yet.
    let ratingNum = null;
    if (rating !== undefined && rating !== null && rating !== 0) {
      ratingNum = Number(rating);
      if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return { statusCode: 400, body: JSON.stringify({ error: "Rating must be between 1 and 5." }) };
      }
    }

    const book = await source.buildBook(item);
    const record = await saveBook(event, sourceId, item, book, ratingNum, category);

    return { statusCode: 200, body: JSON.stringify({ status: "saved", record }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
