const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");
const { checkPublished, recordPublished } = require("../lib/publishLog");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "الطريقة غير مسموحة" }) };
    }
    const { source: sourceId, item, publishCoverOnlyIfNoFile, force } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "بيانات ناقصة" }) };

    const book = await source.buildBook(item);

    // فحص التكرار — يحمي حتى لو نُودي هذا المسار مباشرة بلا مرور بالواجهة،
    // ما لم يُرسل force:true (بعد أن يرى المستخدم التحذير ويؤكد النشر).
    if (!force) {
      let alreadyPublished = null;
      try {
        alreadyPublished = await checkPublished(event, book);
      } catch (e) {
        console.error("تعذّر التحقق من سجل النشر:", e.message);
      }
      if (alreadyPublished) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            book,
            status: "duplicate",
            already_published: true,
            published_at: alreadyPublished.publishedAt,
            message: `⚠️ هذا الكتاب نُشر من قبل. اضغط النشر مرة أخرى للتأكيد إن أردت تكراره.`,
          }),
        };
      }
    }

    const result = await sendBook(book, !!publishCoverOnlyIfNoFile);

    try {
      await recordPublished(event, book);
    } catch (e) {
      console.error("تعذّر تسجيل الكتاب في سجل النشر:", e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ book, ...result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
