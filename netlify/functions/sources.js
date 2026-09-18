const { SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  const authError = await requireAuth(event);
  if (authError) return authError;

  const list = Object.entries(SOURCES).map(([id, s]) => ({ id, name: s.name }));
  return { statusCode: 200, body: JSON.stringify(list) };
};
