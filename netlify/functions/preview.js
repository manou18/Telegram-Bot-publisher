const { SOURCES } = require("../lib/sources");
const { checkPublished } = require("../lib/publishLog");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "الطريقة غير مسموحة" }) };
    }
    const { source: sourceId, item } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "بيانات ناقصة" }) };

    const book = await source.buildBook(item);

    let alreadyPublished = null;
    try {
      alreadyPublished = await checkPublished(event, book);
    } catch (e) {
      console.error("تعذّر التحقق من سجل النشر:", e.message);
    }
    book.already_published = !!alreadyPublished;
    book.published_at = alreadyPublished ? alreadyPublished.publishedAt : null;

    return { statusCode: 200, body: JSON.stringify(book) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
