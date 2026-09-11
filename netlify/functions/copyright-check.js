const { checkCopyrightStatus } = require("../lib/copyrightCheck");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { title, author } = JSON.parse(event.body || "{}");
    if (!title || !title.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Title is required." }) };
    }

    const result = await checkCopyrightStatus(event, title.trim(), (author || "").trim());
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
