const { cancelScheduled, deleteScheduled, getScheduled } = require("../lib/scheduledBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { id } = JSON.parse(event.body || "{}");
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };

    const existing = await getScheduled(event, id);
    if (!existing) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

    if (existing.status === "pending") {
      await cancelScheduled(event, id);
    } else {
      // Already published/failed — "cancel" here just clears it from the list.
      await deleteScheduled(event, id);
    }

    return { statusCode: 200, body: JSON.stringify({ status: "removed" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
