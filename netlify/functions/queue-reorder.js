const { reorderQueueItem } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { id, direction } = JSON.parse(event.body || "{}");
    if (!id || (direction !== "up" && direction !== "down")) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing id or invalid direction" }) };
    }

    const records = await reorderQueueItem(event, id, direction);
    return { statusCode: 200, body: JSON.stringify({ status: "ok", records }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
