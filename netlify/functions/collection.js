const { SOURCES, archiveEduAdvancedSearch } = require("../lib/sources");

// يستخدم بنية بحث Archive.org نفسها المستخدمة في المصدر الثالث (تربية
// وتعليم)، لكن بدل عبارة بحث حرة، يستخدم "collection:(المعرّف)" ليعرض
// محتوى مجموعة محددة بالضبط أدخلها المستخدم يدويًا (مثل
// ukrainian-literature-school-curriculum أو أي معرّف آخر من archive.org).
// النتائج تُبنى دائمًا عبر منطق المصدر 3 (buildBook / displayLine) لأنها
// جميعًا عناصر Internet Archive بغض النظر عن المصدر المختار في الواجهة.

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const collectionId = (q.collection || "").trim();
    if (!collectionId) {
      return { statusCode: 400, body: JSON.stringify({ error: "الرجاء إدخال معرّف المجموعة" }) };
    }

    const query = `collection:(${collectionId})`;
    const data = await archiveEduAdvancedSearch(query, q.next || null);
    const archiveSource = SOURCES[3];
    const results = data.results.map((item) => ({ line: archiveSource.displayLine(item), item }));
    return { statusCode: 200, body: JSON.stringify({ results, next: data.next }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
