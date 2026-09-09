const { SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  const authError = await requireAuth(event);
  if (authError) return authError;

  const source = SOURCES[event.queryStringParameters?.source];
  if (!source) return { statusCode: 404, body: JSON.stringify({ error: "Unknown source" }) };
  const list = Object.entries(source.categories).map(([id, name]) => ({ id, name }));
  return { statusCode: 200, body: JSON.stringify(list) };
};
