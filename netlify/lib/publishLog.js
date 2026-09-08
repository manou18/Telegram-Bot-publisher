// يسجّل كل كتاب يُنشر فعليًا حتى نستطيع تنبيه المستخدم إن حاول نشر نفس
// الكتاب مرة أخرى. نستخدم Netlify Blobs لأنه التخزين الوحيد المتاح لدوال
// Netlify الذي يبقى بين استدعاء وآخر (خلافًا للذاكرة العادية التي تُفرَّغ
// مع كل استدعاء منفصل للدالة).

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

// مفتاح ثابت الطول لكل كتاب: نعتمد رابط التحميل إن وُجد (لأنه الأكثر
// تحديدًا لنسخة بعينها)، وإلا نجمع العنوان والمؤلف والمصدر كبديل لكتاب
// نُشر بغلافه فقط بلا ملف.
function keyFor(book) {
  const raw = book.download_url || `${book.source}::${book.title}::${book.author}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getPublishStore(event) {
  connectLambda(event);
  return getStore("published-books");
}

async function checkPublished(event, book) {
  const store = getPublishStore(event);
  const raw = await store.get(keyFor(book));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function recordPublished(event, book) {
  const store = getPublishStore(event);
  await store.set(
    keyFor(book),
    JSON.stringify({
      title: book.title,
      author: book.author,
      source: book.source,
      publishedAt: new Date().toISOString(),
    })
  );
}

module.exports = { checkPublished, recordPublished };
