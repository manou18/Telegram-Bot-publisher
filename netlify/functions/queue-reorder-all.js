const { reorderQueueByIds } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

// Applies a full new order to the queue in one request — the drag-and-drop reordering in
// the Publish Queue tab sends the complete list of item ids in their new order after a
// drop, instead of one request per single-place move (what the older /api/queue-reorder
// up/down endpoint does).
exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { orderedIds } = JSON.parse(event.body || "{}");
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing orderedIds" }) };
    }

    const records = await reorderQueueByIds(event, orderedIds);
    return { statusCode: 200, body: JSON.stringify({ status: "ok", records }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
