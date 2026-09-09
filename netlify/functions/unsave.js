const { unsaveBook } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item } = JSON.parse(event.body || "{}");
    if (!sourceId || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    await unsaveBook(event, sourceId, item);

    return { statusCode: 200, body: JSON.stringify({ status: "unsaved" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
