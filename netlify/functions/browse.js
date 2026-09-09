const { SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");
const { getRatingsMap, keyForBook } = require("../lib/publishLog");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    const q = event.queryStringParameters || {};
    const source = SOURCES[q.source];
    if (!source) return { statusCode: 404, body: JSON.stringify({ error: "Unknown source" }) };
    const topic = source.categories[q.category];
    if (!topic) return { statusCode: 400, body: JSON.stringify({ error: "Unknown category" }) };

    const data = await source.browseCategory(event, topic, q.next || null);

    let ratings = new Map();
    try {
      ratings = await getRatingsMap(event);
    } catch (e) {
      console.error("Failed to load ratings for sorting:", e.message);
    }
    const results = data.results.map((item) => ({
      line: source.displayLine(item),
      item,
      rating: ratings.get(keyForBook(q.source, item)) || null,
      source_rating: source.sourceRating ? source.sourceRating(item) : null,
    }));

    return { statusCode: 200, body: JSON.stringify({ results, next: data.next }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
