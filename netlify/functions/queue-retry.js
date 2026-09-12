const { retryQueueItem } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

// Resets a "stuck" queue item (one that hit MAX_ATTEMPTS consecutive failures) back to
// "pending" with a clean attempt counter, so the cron picks it up again on the next due
// tick — lets the user fix whatever was wrong (e.g. swap the source link) and put the book
// back in line instead of having to remove it and re-add it from scratch.
exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { id } = JSON.parse(event.body || "{}");
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };

    const record = await retryQueueItem(event, id);
    if (!record) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

    return { statusCode: 200, body: JSON.stringify({ status: "ok", record }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
