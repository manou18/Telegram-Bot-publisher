const { SOURCES } = require("../lib/sources");

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const source = SOURCES[q.source];
    if (!source) return { statusCode: 404, body: JSON.stringify({ error: "Unknown source" }) };
    if (!q.q) return { statusCode: 400, body: JSON.stringify({ error: "Please enter search text" }) };

    const data = await source.search(q.q, q.next || null);
    const results = data.results.map((item) => ({ line: source.displayLine(item), item }));
    return { statusCode: 200, body: JSON.stringify({ results, next: data.next }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
