const { listSaved } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const records = await listSaved(event);

    // Shaped the same way /api/browse and /api/search results are (line + item + source +
    // rating + source_rating), so the frontend can reuse the exact same rendering/sorting/
    // click-to-preview logic.
    const results = records.map((r) => ({
      line: `📌 ${r.title}  —  ${r.author}  (${r.source})`,
      item: r.item,
      source: r.sourceId,
      rating: r.rating || null,
      source_rating: r.source_rating || null,
      category: r.category || null,
    }));

    return { statusCode: 200, body: JSON.stringify({ results }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
