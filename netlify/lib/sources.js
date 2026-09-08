// منطق المصادر (Gutenberg / Open Library) — بلا أي حالة محفوظة على الخادم،
// لأن دوال Netlify (serverless) لا تضمن بقاء الذاكرة بين استدعاء وآخر.

// أهم نقطة هنا: بعض الواجهات (Gutendex، وأحيانًا Open Library) تحمي نفسها
// عبر Cloudflare وترفض الطلبات التي لا تحمل ترويسة User-Agent تشبه متصفحًا
// حقيقيًا — الطلب الافتراضي من fetch داخل دالة Netlify (بلا ترويسات) كان
// يتلقى صفحة HTML بدل JSON، وهذا هو سبب خطأ
// "Unexpected token '<' ... is not valid JSON" الذي كان يظهر للمستخدم.
// fetchJson أدناه يرسل ترويسات مناسبة ويعطي رسالة عربية واضحة عند الفشل
// بدل تمرير خطأ JSON.parse الخام.

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  const contentType = r.headers.get("content-type") || "";
  if (!r.ok || !contentType.includes("json")) {
    const snippet = (await r.text()).slice(0, 200);
    console.error(`فشل الطلب إلى ${url} — الحالة ${r.status} — بداية الرد: ${snippet}`);
    throw new Error(
      `تعذّر جلب البيانات من المصدر الخارجي (الحالة ${r.status}). حاول لاحقًا أو جرّب المصدر الآخر.`
    );
  }
  return r.json();
}

const GUTENBERG_CATEGORIES = {
  1: "fiction",
  2: "science fiction",
  3: "romance",
  4: "adventure",
  5: "mystery",
  6: "history",
  7: "philosophy",
  8: "poetry",
  9: "children",
  10: "biography",
  11: "cooking",
  12: "travel",
  13: "nature",
  14: "health",
  15: "nutrition",
  16: "education",
  17: "teaching",
  18: "reference",
  19: "how to",
  20: "sports",
};

async function gutenbergBrowseCategory(topic, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?topic=${encodeURIComponent(topic)}`;
  const data = await fetchJson(finalUrl);
  return { results: data.results || [], next: data.next || null };
}

async function gutenbergSearch(query, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const data = await fetchJson(finalUrl);
  return { results: data.results || [], next: data.next || null };
}

function gutenbergDisplayLine(info) {
  const authors = (info.authors || []).map((a) => a.name).join(", ") || "غير معروف";
  return `${info.title}  —  ${authors}`;
}

function gutenbergBuildBook(info) {
  const formats = info.formats || {};
  const downloadUrl = formats["application/pdf"] || formats["application/epub+zip"] || null;
  return {
    title: info.title,
    author: (info.authors || []).map((a) => a.name).join(", ") || "غير معروف",
    cover_url: formats["image/jpeg"] || null,
    download_url: downloadUrl,
    source: "Project Gutenberg",
  };
}

const OPENLIBRARY_CATEGORIES = {
  1: "fiction",
  2: "science_fiction",
  3: "romance",
  4: "adventure",
  5: "mystery_and_detective_stories",
  6: "history",
  7: "philosophy",
  8: "poetry",
  9: "children",
  10: "biography",
};

async function openlibraryBrowseCategory(subject, offsetToken) {
  const offset = offsetToken ? parseInt(offsetToken, 10) : 0;
  const url = `https://openlibrary.org/subjects/${subject}.json?limit=10&offset=${offset}`;
  const data = await fetchJson(url);
  const works = data.works || [];
  const total = data.work_count || 0;
  const nextOffset = offset + 10 < total ? offset + 10 : null;
  return { results: works, next: nextOffset !== null ? String(nextOffset) : null };
}

async function openlibrarySearch(query, pageToken) {
  const page = pageToken ? parseInt(pageToken, 10) : 1;
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&page=${page}`;
  const data = await fetchJson(url);
  const docs = data.docs || [];
  const total = data.numFound || 0;
  const nextPage = page * 10 < total ? page + 1 : null;
  return { results: docs, next: nextPage !== null ? String(nextPage) : null };
}

function openlibraryDisplayLine(doc) {
  let authors;
  if (doc.authors) authors = (doc.authors || []).map((a) => a.name || "").join(", ") || "غير معروف";
  else authors = (doc.author_name || []).join(", ") || "غير معروف";
  return `${doc.title}  —  ${authors}`;
}

async function findArchiveFile(iaId, extensions) {
  const data = await fetchJson(`https://archive.org/metadata/${iaId}`);
  for (const f of data.files || []) {
    const name = f.name || "";
    if (extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
      return `https://archive.org/download/${iaId}/${name}`;
    }
  }
  return null;
}

async function openlibraryBuildBook(doc) {
  const title = doc.title;
  let author;
  if (doc.authors) author = (doc.authors || []).map((a) => a.name || "").join(", ") || "غير معروف";
  else author = (doc.author_name || []).join(", ") || "غير معروف";

  let iaId = null;
  if (Array.isArray(doc.ia) && doc.ia.length) iaId = doc.ia[0];
  else if (typeof doc.ia === "string") iaId = doc.ia;

  let downloadUrl = null;
  let coverUrl = null;

  if (iaId) {
    downloadUrl = await findArchiveFile(iaId, [".pdf", ".epub"]);
    coverUrl = `https://archive.org/services/img/${iaId}`;
  } else if (doc.cover_i) {
    coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }

  return { title, author, cover_url: coverUrl, download_url: downloadUrl, source: "Open Library / Internet Archive" };
}

// =========================================================
//  المصدر 3: Internet Archive — كتب تربية وتعليم ونفس ولغة
//  إنجليزية (نظريات تعلم، إدارة صف، علم نفس تربوي، نحو، TEFL)
// =========================================================
// يستخدم بحث Archive.org المتقدم (advancedsearch.php) بدل صفحات
// المواضيع الجاهزة، لأنه يسمح بعبارات بحث حرة (مثل "TEFL" أو
// "classroom management") تغطي مجالات تربوية لا تغطيها فهارس
// Gutenberg/Open Library الأدبية. findArchiveFile وخدمة الأغلفة
// نفس الدوال المستخدمة أعلاه لمصدر Open Library.

const ARCHIVE_EDU_CATEGORIES = {
  1: "learning theories",
  2: "classroom management",
  3: "educational psychology",
  4: "english grammar",
  5: "TEFL TESL teaching english foreign language",
  6: "curriculum instruction teaching methods",
};

async function archiveEduAdvancedSearch(query, pageToken) {
  const page = pageToken ? parseInt(pageToken, 10) : 1;
  const params = new URLSearchParams();
  params.append("q", `(${query}) AND mediatype:(texts)`);
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "creator");
  params.append("sort[]", "downloads desc");
  params.append("rows", "10");
  params.append("page", String(page));
  params.append("output", "json");

  const data = await fetchJson(`https://archive.org/advancedsearch.php?${params.toString()}`);
  const docs = (data.response && data.response.docs) || [];
  const total = (data.response && data.response.numFound) || 0;
  const nextPage = page * 10 < total ? page + 1 : null;
  return { results: docs, next: nextPage !== null ? String(nextPage) : null };
}

async function archiveEduBrowseCategory(topic, pageToken) {
  return archiveEduAdvancedSearch(topic, pageToken);
}

async function archiveEduSearch(query, pageToken) {
  return archiveEduAdvancedSearch(query, pageToken);
}

function archiveEduAuthors(doc) {
  if (Array.isArray(doc.creator)) return doc.creator.join(", ") || "غير معروف";
  return doc.creator || "غير معروف";
}

function archiveEduDisplayLine(doc) {
  return `${doc.title}  —  ${archiveEduAuthors(doc)}`;
}

async function archiveEduBuildBook(doc) {
  const iaId = doc.identifier;
  const downloadUrl = iaId ? await findArchiveFile(iaId, [".pdf", ".epub"]) : null;
  const coverUrl = iaId ? `https://archive.org/services/img/${iaId}` : null;
  return {
    title: doc.title,
    author: archiveEduAuthors(doc),
    cover_url: coverUrl,
    download_url: downloadUrl,
    source: "Internet Archive — تربية وتعليم",
  };
}

const SOURCES = {
  1: {
    name: "Project Gutenberg",
    categories: GUTENBERG_CATEGORIES,
    browseCategory: gutenbergBrowseCategory,
    search: gutenbergSearch,
    displayLine: gutenbergDisplayLine,
    buildBook: gutenbergBuildBook,
  },
  2: {
    name: "Open Library / Internet Archive",
    categories: OPENLIBRARY_CATEGORIES,
    browseCategory: openlibraryBrowseCategory,
    search: openlibrarySearch,
    displayLine: openlibraryDisplayLine,
    buildBook: openlibraryBuildBook,
  },
  3: {
    name: "Internet Archive — تربية وتعليم ونفس ولغة إنجليزية",
    categories: ARCHIVE_EDU_CATEGORIES,
    browseCategory: archiveEduBrowseCategory,
    search: archiveEduSearch,
    displayLine: archiveEduDisplayLine,
    buildBook: archiveEduBuildBook,
  },
};

module.exports = { SOURCES, archiveEduAdvancedSearch };
