const { updatePublishedRating } = require("../lib/publishLog");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, rating } = JSON.parse(event.body || "{}");
    if (!sourceId || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return { statusCode: 400, body: JSON.stringify({ error: "Rating must be between 1 and 5." }) };
    }

    const record = await updatePublishedRating(event, sourceId, item, ratingNum);
    if (!record) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "This book hasn't been published yet, so there's no rating to update." }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ status: "updated", record }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
