// منطق المصادر (Gutenberg / Open Library) — بلا أي حالة محفوظة على الخادم،
// لأن دوال Netlify (serverless) لا تضمن بقاء الذاكرة بين استدعاء وآخر.

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
};

async function gutenbergBrowseCategory(topic, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?topic=${encodeURIComponent(topic)}`;
  const r = await fetch(finalUrl);
  const data = await r.json();
  return { results: data.results || [], next: data.next || null };
}

async function gutenbergSearch(query, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const r = await fetch(finalUrl);
  const data = await r.json();
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
  const r = await fetch(url);
  const data = await r.json();
  const works = data.works || [];
  const total = data.work_count || 0;
  const nextOffset = offset + 10 < total ? offset + 10 : null;
  return { results: works, next: nextOffset !== null ? String(nextOffset) : null };
}

async function openlibrarySearch(query, pageToken) {
  const page = pageToken ? parseInt(pageToken, 10) : 1;
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&page=${page}`;
  const r = await fetch(url);
  const data = await r.json();
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
  const r = await fetch(`https://archive.org/metadata/${iaId}`);
  const data = await r.json();
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
};

module.exports = { SOURCES };
