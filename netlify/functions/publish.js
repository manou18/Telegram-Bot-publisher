const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "الطريقة غير مسموحة" }) };
    }
    const { source: sourceId, item, publishCoverOnlyIfNoFile } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "بيانات ناقصة" }) };

    const book = await source.buildBook(item);
    const result = await sendBook(book, !!publishCoverOnlyIfNoFile);
    return { statusCode: 200, body: JSON.stringify({ book, ...result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
