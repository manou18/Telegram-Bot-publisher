// ==========================================================
//  Source 3: Internet Archive — education, teaching, psychology,
//  and English-language books (learning theories, classroom
//  management, educational psychology, grammar, TEFL)
// ==========================================================
// Uses Archive.org's advanced search (advancedsearch.php) instead of the
// ready-made topic pages, because it allows free-text search phrases (like
// "TEFL" or "classroom management") that cover educational fields the
// literary Gutenberg/Open Library catalogs don't. fetchArchiveInfo (from
// _archiveHelpers) and the cover service are the same ones used by the
// Open Library source.

const { fetchJson, cachedFetchJson } = require("./_http");
const { fetchArchiveInfo } = require("./_archiveHelpers");

const ARCHIVE_EDU_CATEGORIES = {
  1: "learning theories",
  2: "classroom management",
  3: "educational psychology",
  4: "english grammar",
  5: "TEFL TESL teaching english foreign language",
  6: "curriculum instruction teaching methods",
  7: "education",
  8: "second language acquisition",
  9: "educational technology",
};

async function archiveEduAdvancedSearch(event, query, pageToken) {
  const page = pageToken ? parseInt(pageToken, 10) : 1;
  const params = new URLSearchParams();
  params.append("q", `(${query}) AND mediatype:(texts)`);
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "creator");
  params.append("fl[]", "language");
  params.append("sort[]", "downloads desc");
  params.append("rows", "10");
  params.append("page", String(page));
  params.append("output", "json");

  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  const data = await cachedFetchJson(event, url, fetchJson);
  const docs = (data.response && data.response.docs) || [];
  const total = (data.response && data.response.numFound) || 0;
  const nextPage = page * 10 < total ? page + 1 : null;
  return { results: docs, next: nextPage !== null ? String(nextPage) : null };
}

async function archiveEduBrowseCategory(event, topic, pageToken) {
  return archiveEduAdvancedSearch(event, topic, pageToken);
}

async function archiveEduSearch(event, query, pageToken) {
  return archiveEduAdvancedSearch(event, query, pageToken);
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
    language: info.language || null,
    source: "Internet Archive — Education & Teaching",
    // Fallback for when the item turned out to be borrow-only/restricted (no direct
    // file above) — at least send the user to the item's own archive.org page instead
    // of leaving them with nothing to click.
    source_url: iaId ? `https://archive.org/details/${iaId}` : null,
  };
}

module.exports = {
  name: "Internet Archive — Education, Teaching & Psychology",
  categories: ARCHIVE_EDU_CATEGORIES,
  browseCategory: archiveEduBrowseCategory,
  search: archiveEduSearch,
  displayLine: archiveEduDisplayLine,
  buildBook: archiveEduBuildBook,
  // Also exported standalone: netlify/functions/collection.js calls this directly
  // (not through the registry) to power its own advanced-search based browsing.
  archiveEduAdvancedSearch,
};
