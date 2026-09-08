// يحاول أولًا تمرير رابط الملف مباشرة لتيليجرام (الأخف على دالة Netlify،
// لأن تيليجرام هو من يجلب الملف لا نحن). فقط عند فشل هذه الطريقة — غالبًا
// بسبب حجم الملف — يلجأ لتنزيله هنا مؤقتًا ثم رفعه كملف (multipart)،
// وهو ما يزيد وقت تنفيذ الدالة، فانتبه لحد المهلة في إعدادات Netlify
// عند نشر كتب كبيرة (راجع ملاحظة الحدود في README).

function getCreds() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;
  if (!BOT_TOKEN || !CHANNEL_ID) {
    throw new Error("لم يتم ضبط BOT_TOKEN أو CHANNEL_ID كمتغيرات بيئة في Netlify.");
  }
  return { BOT_TOKEN, CHANNEL_ID };
}

async function telegramPost(method, payload) {
  const { BOT_TOKEN } = getCreds();
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `فشل استدعاء ${method}`);
  return data;
}

async function sendCoverAndCaption(book) {
  const { CHANNEL_ID } = getCreds();
  const caption = `📚 <b>${book.title}</b>\n✍️ ${book.author}\n📖 ${book.source}`;
  if (book.cover_url) {
    await telegramPost("sendPhoto", {
      chat_id: CHANNEL_ID,
      photo: book.cover_url,
      caption,
      parse_mode: "HTML",
    });
  } else {
    await telegramPost("sendMessage", { chat_id: CHANNEL_ID, text: caption, parse_mode: "HTML" });
  }
}

// يحاول أولًا تمرير الرابط مباشرة (الأسرع، وكافٍ لأغلب الحالات لأن تيليجرام
// هو من يجلب الملف). إن رفض تيليجرام الرابط — غالبًا لأن الملف أكبر من حد
// الـ 20 ميجا المسموح بها لطريقة الرابط، أو الرابط يحتاج رؤوس/تحويلات لا
// يدعمها تيليجرام مباشرة — يتحول تلقائيًا لتنزيل الملف هنا ثم رفعه كملف
// حقيقي (multipart)، وهو ما يدعم حتى 50 ميجا عبر الرفع المباشر.
async function sendBookFile(book) {
  const { BOT_TOKEN, CHANNEL_ID } = getCreds();

  try {
    await telegramPost("sendDocument", { chat_id: CHANNEL_ID, document: book.download_url });
    return;
  } catch (urlError) {
    console.warn(`تعذّر إرسال الرابط مباشرة (${urlError.message})، جارٍ التنزيل ثم الرفع...`);
  }

  const fileRes = await fetch(book.download_url);
  if (!fileRes.ok) {
    throw new Error(`تعذّر تنزيل الملف من المصدر (HTTP ${fileRes.status}).`);
  }

  const contentLength = Number(fileRes.headers.get("content-length") || 0);
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // حد الرفع المباشر لبوتات تيليجرام العادية
  if (contentLength && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `حجم الملف (${(contentLength / 1024 / 1024).toFixed(1)} ميجا) أكبر من حد رفع البوت (50 ميجا).`
    );
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const ext = book.download_url.toLowerCase().endsWith(".pdf") ? ".pdf" : ".epub";
  const filename = `book${ext}`;

  const form = new FormData();
  form.append("chat_id", CHANNEL_ID);
  form.append("document", new Blob([arrayBuffer]), filename);

  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await r.json();
  if (!data.ok) {
    throw new Error(data.description || "فشل رفع الملف مباشرة بعد تنزيله أيضًا.");
  }
}

async function sendBook(book, publishCoverOnlyIfNoFile) {
  if (!book.download_url) {
    if (!publishCoverOnlyIfNoFile) {
      return { status: "skipped", message: "لا يوجد ملف قابل للتحميل، لم يُنشر أي شيء." };
    }
    await sendCoverAndCaption(book);
    return { status: "cover_only", message: `تم نشر الغلاف والمعلومات فقط لكتاب: ${book.title}` };
  }
  await sendCoverAndCaption(book);
  await sendBookFile(book);
  return { status: "published", message: `تم نشر: ${book.title}` };
}

module.exports = { sendBook };
