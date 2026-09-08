// Source logic (Gutenberg / Open Library) — no state stored on the server,
// since Netlify (serverless) functions don't guarantee memory persists between calls.

// Key point: some APIs (Gutendex, sometimes Open Library) protect themselves
// via Cloudflare and reject requests without headers that look like a real browser —
// the default fetch request inside a Netlify function (no headers) used to get an
// HTML page instead of JSON, which is why the "Unexpected token '<' ... is not valid JSON"
// error used to show up for the user. fetchJson below sends proper headers, retries
// automatically on transient errors (403/429/5xx) — because Cloudflare's protection
// in front of gutendex.com specifically is known to be flaky (succeeds sometimes,
// fails sometimes for the exact same request) — and gives a clear error message on
// final failure instead of passing along the raw JSON.parse error.

const RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      Referer: `${new URL(url).origin}/`,
    },
  });

  const contentType = r.headers.get("content-type") || "";
  if (!r.ok || !contentType.includes("json")) {
    const snippet = (await r.text()).slice(0, 200);
    console.error(
      `Request to ${url} failed — status ${r.status} — attempt ${attempt}/${MAX_ATTEMPTS} — response start: ${snippet}`
    );

    if (RETRYABLE_STATUS.has(r.status) && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 500); // simple increasing delay before retrying
      return fetchJson(url, attempt + 1);
    }

    const hint =
      r.status === 403
        ? " The source's protection (Cloudflare) appears to have rejected the request — it may be a temporary block, so try again shortly or use another source for now."
        : " Try again later or try the other source.";
    throw new Error(`Could not fetch data from the external source (status ${r.status}).${hint}`);
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
  const authors = (info.authors || []).map((a) => a.name).join(", ") || "Unknown";
  return `${info.title}  —  ${authors}`;
}

function gutenbergBuildBook(info) {
  const formats = info.formats || {};
  const pdfUrl = formats["application/pdf"] || null;
  const epubUrl = formats["application/epub+zip"] || null;
  // Gutendex sometimes provides a ready-made summary in summaries (usually sourced from Wikipedia).
  const summaries = info.summaries || [];
  return {
    title: info.title,
    author: (info.authors || []).map((a) => a.name).join(", ") || "Unknown",
    cover_url: formats["image/jpeg"] || null,
    // download_url: the default choice (PDF preferred) — kept for compatibility with any older code.
    download_url: pdfUrl || epubUrl || null,
    download_url_pdf: pdfUrl,
    download_url_epub: epubUrl,
    description: summaries.length ? summaries.join("\n\n") : null,
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
  if (doc.authors) authors = (doc.authors || []).map((a) => a.name || "").join(", ") || "Unknown";
  else authors = (doc.author_name || []).join(", ") || "Unknown";
  return `${doc.title}  —  ${authors}`;
}

// Looks for all requested formats together instead of stopping at the first match, so we know if
// the item has both PDF and EPUB and can give the user the choice between them.
// It also extracts the book description from the same archive.org/metadata response (metadata.description)
// without needing an extra request. Returns { files: { ".pdf": url, ".epub": url }, description }.
async function fetchArchiveInfo(iaId, extensions) {
  const data = await fetchJson(`https://archive.org/metadata/${iaId}`);
  const found = {};
  extensions.forEach((ext) => (found[ext] = null));
  for (const f of data.files || []) {
    const name = f.name || "";
    const lower = name.toLowerCase();
    for (const ext of extensions) {
      if (!found[ext] && lower.endsWith(ext)) {
        found[ext] = `https://archive.org/download/${iaId}/${name}`;
      }
    }
  }

  const meta = data.metadata || {};
  let description = meta.description || null;
  if (Array.isArray(description)) description = description.join("\n\n");
  if (description) {
    // archive.org descriptions often contain simple HTML tags (paragraphs, line breaks) — clean it up for plain-text display.
    description = description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();
  }

  return { files: found, description: description || null };
}

// Open Library descriptions don't come directly with search/browse results — they require a
// separate request to the work page itself (works/OL...W.json). description may be plain
// text or an object shaped like { value: "..." }, per Open Library's docs.
async function openlibraryFetchDescription(doc) {
  if (!doc.key) return null;
  try {
    const data = await fetchJson(`https://openlibrary.org${doc.key}.json`);
    const desc = data.description;
    if (!desc) return null;
    return (typeof desc === "string" ? desc : desc.value || null) || null;
  } catch (e) {
    console.error("Failed to fetch book description from Open Library:", e.message);
    return null;
  }
}

async function openlibraryBuildBook(doc) {
  const title = doc.title;
  let author;
  if (doc.authors) author = (doc.authors || []).map((a) => a.name || "").join(", ") || "Unknown";
  else author = (doc.author_name || []).join(", ") || "Unknown";

  let iaId = null;
  if (Array.isArray(doc.ia) && doc.ia.length) iaId = doc.ia[0];
  else if (typeof doc.ia === "string") iaId = doc.ia;

  let downloadUrlPdf = null;
  let downloadUrlEpub = null;
  let coverUrl = null;
  let description = null;

  if (iaId) {
    const info = await fetchArchiveInfo(iaId, [".pdf", ".epub"]);
    downloadUrlPdf = info.files[".pdf"];
    downloadUrlEpub = info.files[".epub"];
    coverUrl = `https://archive.org/services/img/${iaId}`;
    description = info.description;
  } else if (doc.cover_i) {
    coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }

  if (!description) {
    description = await openlibraryFetchDescription(doc);
  }

  return {
    title,
    author,
    cover_url: coverUrl,
    download_url: downloadUrlPdf || downloadUrlEpub || null,
    download_url_pdf: downloadUrlPdf,
    download_url_epub: downloadUrlEpub,
    description,
    source: "Open Library / Internet Archive",
  };
}


// =========================================================
//  Source 3: Internet Archive — education, teaching, psychology,
//  and English-language books (learning theories, classroom
//  management, educational psychology, grammar, TEFL)
// =========================================================
// Uses Archive.org's advanced search (advancedsearch.php) instead of the
// ready-made topic pages, because it allows free-text search phrases (like
// "TEFL" or "classroom management") that cover educational fields the
// literary Gutenberg/Open Library catalogs don't. fetchArchiveInfo and the
// cover service are the same functions used above for the Open Library source.

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
  if (Array.isArray(doc.creator)) return doc.creator.join(", ") || "Unknown";
  return doc.creator || "Unknown";
}

function archiveEduDisplayLine(doc) {
  return `${doc.title}  —  ${archiveEduAuthors(doc)}`;
}

async function archiveEduBuildBook(doc) {
  const iaId = doc.identifier;
  const info = iaId
    ? await fetchArchiveInfo(iaId, [".pdf", ".epub"])
    : { files: { ".pdf": null, ".epub": null }, description: null };
  const downloadUrlPdf = info.files[".pdf"];
  const downloadUrlEpub = info.files[".epub"];
  const coverUrl = iaId ? `https://archive.org/services/img/${iaId}` : null;
  return {
    title: doc.title,
    author: archiveEduAuthors(doc),
    cover_url: coverUrl,
    download_url: downloadUrlPdf || downloadUrlEpub || null,
    download_url_pdf: downloadUrlPdf,
    download_url_epub: downloadUrlEpub,
    description: info.description,
    source: "Internet Archive — Education & Teaching",
  };
}

// =========================================================
//  Source 4: OAPEN — open-access academic books
// =========================================================
// The OAPEN Library is built on DSpace 5, and offers a public JSON REST API with no
// access key needed: https://library.oapen.org/rest/search?query=...&expand=metadata,bitstreams
// The response is a plain array of items (no pagination wrapper), so we simulate
// pagination ourselves via limit/offset and assume a next page exists if the result
// count equals the limit. The "categories" here are effectively the platform's biggest
// publishers (real data from the oapen.org API) since subject classification lists
// (BIC/Thema) aren't published as stable values that can be reliably relied on for
// filtering directly via the API.

const OAPEN_BASE = "https://library.oapen.org";

const OAPEN_CATEGORIES = {
  1: "Taylor & Francis",
  2: "Firenze University Press",
  3: "Springer Nature",
  4: "transcript Verlag",
  5: "De Gruyter",
  6: "Brill",
  7: "Amsterdam University Press",
  8: "Peter Lang International Academic Publishers",
};

function oapenMetaValue(metadata, key) {
  const m = (metadata || []).find((entry) => entry.key === key);
  return m ? m.value : null;
}

function oapenMetaValues(metadata, key) {
  return (metadata || []).filter((entry) => entry.key === key).map((entry) => entry.value);
}

async function oapenSearchRaw(queryString, pageToken) {
  const limit = 10;
  const offset = pageToken ? parseInt(pageToken, 10) : 0;
  const url = `${OAPEN_BASE}/rest/search?query=${encodeURIComponent(
    queryString
  )}&expand=metadata,bitstreams&limit=${limit}&offset=${offset}`;
  const data = await fetchJson(url);
  const results = Array.isArray(data) ? data : [];
  const next = results.length === limit ? String(offset + limit) : null;
  return { results, next };
}

async function oapenBrowseCategory(publisherName, pageToken) {
  return oapenSearchRaw(`publisher.name:"${publisherName}"`, pageToken);
}

async function oapenSearch(query, pageToken) {
  return oapenSearchRaw(query, pageToken);
}

function oapenAuthors(item) {
  const authors = oapenMetaValues(item.metadata, "dc.contributor.author");
  return authors.length ? authors.join(", ") : "Unknown";
}

function oapenDisplayLine(item) {
  const title = oapenMetaValue(item.metadata, "dc.title") || item.name || "Untitled";
  return `${title}  —  ${oapenAuthors(item)}`;
}

async function oapenBuildBook(item) {
  const metadata = item.metadata || [];
  const bitstreams = item.bitstreams || [];
  const title = oapenMetaValue(metadata, "dc.title") || item.name || "Untitled";
  const description = oapenMetaValue(metadata, "dc.description.abstract");

  const pdfBitstream = bitstreams.find(
    (b) => b.bundleName === "ORIGINAL" && (b.mimeType === "application/pdf" || /\.pdf$/i.test(b.name || ""))
  );
  const thumbBitstream = bitstreams.find((b) => b.bundleName === "THUMBNAIL");

  const downloadUrlPdf = pdfBitstream ? `${OAPEN_BASE}${pdfBitstream.retrieveLink}` : null;
  const coverUrl = thumbBitstream ? `${OAPEN_BASE}${thumbBitstream.retrieveLink}` : null;

  return {
    title,
    author: oapenAuthors(item),
    cover_url: coverUrl,
    // OAPEN books are all academic PDFs, and aren't usually available in EPUB.
    download_url: downloadUrlPdf,
    download_url_pdf: downloadUrlPdf,
    download_url_epub: null,
    description,
    source: "OAPEN — Open-Access Academic Books",
  };
}


// =========================================================
// Source 5: Google Books — public-domain/full-view books only
// The Google Books API exposes public volume metadata without authentication.
// We deliberately use filter=full and only publish direct download links when
// Google marks the volume as public domain / full public access.
// =========================================================
const GOOGLE_BOOKS_CATEGORIES = {
  1: "fiction",
  2: "science fiction",
  3: "romance",
  4: "mystery",
  5: "history",
  6: "philosophy",
  7: "poetry",
  8: "biography",
  9: "education",
  10: "science",
};

async function googleBooksSearch(query, pageToken) {
  const startIndex = pageToken ? parseInt(pageToken, 10) : 0;
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}` +
    `&filter=full&maxResults=10&startIndex=${startIndex}`;
  const data = await fetchJson(url);
  const results = data.items || [];
  const total = data.totalItems || 0;
  const next = startIndex + results.length < total && results.length
    ? String(startIndex + results.length)
    : null;
  return { results, next };
}

async function googleBooksBrowseCategory(topic, pageToken) {
  return googleBooksSearch(`subject:${topic}`, pageToken);
}

function googleBooksDisplayLine(item) {
  const info = item.volumeInfo || {};
  const authors = (info.authors || []).join(", ") || "Unknown";
  return `${info.title || "Untitled"}  —  ${authors}`;
}

async function googleBooksBuildBook(item) {
  const info = item.volumeInfo || {};
  const access = item.accessInfo || {};
  const isPublicDomain =
    access.publicDomain === true || access.accessViewStatus === "FULL_PUBLIC_DOMAIN";

  // Only expose direct download links when Google marks the book as public-domain/full-access.
  const pdf = isPublicDomain && access.pdf && access.pdf.downloadLink
    ? access.pdf.downloadLink
    : null;
  const epub = isPublicDomain && access.epub && access.epub.downloadLink
    ? access.epub.downloadLink
    : null;

  return {
    title: info.title || "Untitled",
    author: (info.authors || []).join(", ") || "Unknown",
    cover_url: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null,
    download_url: pdf || epub || null,
    download_url_pdf: pdf,
    download_url_epub: epub,
    description: info.description || null,
    source: "Google Books — Public Domain",
    source_url: info.infoLink || info.previewLink || null,
  };
}

// =========================================================
// Source 6: DOAB — Directory of Open Access Books
// DOAB provides a public REST API for metadata and open-access book files.
// =========================================================
const DOAB_BASE = "https://directory.doabooks.org";

const DOAB_CATEGORIES = {
  1: "education",
  2: "history",
  3: "science",
  4: "social sciences",
  5: "literature",
  6: "philosophy",
  7: "language",
  8: "technology",
};

function doabMetaValue(metadata, key) {
  const m = (metadata || []).find((entry) => entry.key === key);
  return m ? m.value : null;
}

function doabMetaValues(metadata, key) {
  return (metadata || []).filter((entry) => entry.key === key).map((entry) => entry.value);
}

async function doabSearchRaw(queryString, pageToken) {
  const limit = 10;
  const offset = pageToken ? parseInt(pageToken, 10) : 0;
  const url =
    `${DOAB_BASE}/rest/search?query=${encodeURIComponent(queryString)}` +
    `&expand=metadata,bitstreams&limit=${limit}&offset=${offset}`;
  const data = await fetchJson(url);
  const results = Array.isArray(data) ? data : [];
  const next = results.length === limit ? String(offset + limit) : null;
  return { results, next };
}

async function doabSearch(query, pageToken) {
  return doabSearchRaw(query, pageToken);
}

async function doabBrowseCategory(topic, pageToken) {
  return doabSearchRaw(`"${topic}"`, pageToken);
}

function doabAuthors(item) {
  const authors = doabMetaValues(item.metadata, "dc.contributor.author");
  return authors.length ? authors.join(", ") : "Unknown";
}

function doabDisplayLine(item) {
  const title = doabMetaValue(item.metadata, "dc.title") || item.name || "Untitled";
  return `${title}  —  ${doabAuthors(item)}`;
}

function doabBitstreamUrl(bitstream) {
  if (!bitstream) return null;
  if (bitstream.retrieveLink) return `${DOAB_BASE}${bitstream.retrieveLink}`;
  if (bitstream.content) return bitstream.content;
  return null;
}

async function doabBuildBook(item) {
  const metadata = item.metadata || [];
  const bitstreams = item.bitstreams || [];
  const title = doabMetaValue(metadata, "dc.title") || item.name || "Untitled";
  const description = doabMetaValue(metadata, "dc.description.abstract") ||
    doabMetaValue(metadata, "dc.description");
  const pdfBitstream = bitstreams.find(
    (b) => /pdf/i.test(b.mimeType || "") || /\.pdf$/i.test(b.name || "")
  );
  const epubBitstream = bitstreams.find(
    (b) => /epub/i.test(b.mimeType || "") || /\.epub$/i.test(b.name || "")
  );
  const thumbBitstream = bitstreams.find((b) => b.bundleName === "THUMBNAIL");

  const pdf = doabBitstreamUrl(pdfBitstream);
  const epub = doabBitstreamUrl(epubBitstream);
  const cover = doabBitstreamUrl(thumbBitstream);

  return {
    title,
    author: doabAuthors(item),
    cover_url: cover,
    download_url: pdf || epub || null,
    download_url_pdf: pdf,
    download_url_epub: epub,
    description,
    source: "DOAB — Open Access Books",
    source_url: item.handle ? `https://directory.doabooks.org/handle/${item.handle}` : null,
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
    name: "Internet Archive — Education, Teaching & Psychology",
    categories: ARCHIVE_EDU_CATEGORIES,
    browseCategory: archiveEduBrowseCategory,
    search: archiveEduSearch,
    displayLine: archiveEduDisplayLine,
    buildBook: archiveEduBuildBook,
  },
  4: {
    name: "OAPEN — Open-Access Academic Books",
    categories: OAPEN_CATEGORIES,
    browseCategory: oapenBrowseCategory,
    search: oapenSearch,
    displayLine: oapenDisplayLine,
    buildBook: oapenBuildBook,
  },
  5: {
    name: "Google Books — Public Domain",
    categories: GOOGLE_BOOKS_CATEGORIES,
    browseCategory: googleBooksBrowseCategory,
    search: googleBooksSearch,
    displayLine: googleBooksDisplayLine,
    buildBook: googleBooksBuildBook,
  },
  6: {
    name: "DOAB — Open Access Books",
    categories: DOAB_CATEGORIES,
    browseCategory: doabBrowseCategory,
    search: doabSearch,
    displayLine: doabDisplayLine,
    buildBook: doabBuildBook,
  },
};

module.exports = { SOURCES, archiveEduAdvancedSearch };
