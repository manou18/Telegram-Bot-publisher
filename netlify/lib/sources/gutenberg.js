// ==========================================================
//  Source 1: Project Gutenberg (via the Gutendex API)
// ==========================================================

const { fetchJson, cachedFetchJson } = require("./_http");

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

async function gutenbergBrowseCategory(event, topic, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?topic=${encodeURIComponent(topic)}`;
  const data = await cachedFetchJson(event, finalUrl, fetchJson);
  return { results: data.results || [], next: data.next || null };
}

async function gutenbergSearch(event, query, pageUrl) {
  const finalUrl = pageUrl || `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const data = await cachedFetchJson(event, finalUrl, fetchJson);
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

module.exports = {
  name: "Project Gutenberg",
  categories: GUTENBERG_CATEGORIES,
  browseCategory: gutenbergBrowseCategory,
  search: gutenbergSearch,
  displayLine: gutenbergDisplayLine,
  buildBook: gutenbergBuildBook,
};
