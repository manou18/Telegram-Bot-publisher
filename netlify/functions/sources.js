const { SOURCES } = require("../lib/sources");

exports.handler = async () => {
  const list = Object.entries(SOURCES).map(([id, s]) => ({ id, name: s.name }));
  return { statusCode: 200, body: JSON.stringify(list) };
};
