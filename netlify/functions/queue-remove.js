const { removeFromQueue } = require("../lib/publishQueue");
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

    const removed = await removeFromQueue(event, id);
    if (!removed) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

    return { statusCode: 200, body: JSON.stringify({ status: "removed", record: removed }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
