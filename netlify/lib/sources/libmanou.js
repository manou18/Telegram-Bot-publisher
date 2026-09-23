// ==========================================================
//  EXAMPLE SOURCE — "libmanou" is a made-up library, not a real API.
//  This file exists purely as a worked template: it follows the exact same shape as every
//  real source (gutenberg.js, oapen.js...) but searches an in-memory fake catalog instead of
//  calling a real endpoint, so you can see the whole pipeline (search → browse → display →
//  download) work end-to-end without needing a live API to test against.
//
//  Safe to delete once you understand the pattern — just also remove its two registration
//  lines in ./index.js and (if you added it) netlify/lib/bookBot.js's SEARCH_SOURCES.
// ==========================================================

// A real source would import fetchJson/cachedFetchJson here and call a live API:
//   const { fetchJson, cachedFetchJson } = require("./_http");
// libmanou has no real API, so this file skips that entirely and just searches the array below.

const LIBMANOU_CATEGORIES = {
  1: "fiction",
  2: "philosophy",
};

// The fake catalog. In a real source, this data would come from an HTTP request instead.
const FAKE_CATALOG = [
  {
    title: "The Clockmaker's Paradox",
    author: "Manou Example",
    category: 1,
    language: "eng",
    description: "A fictional novel used only to demonstrate how a new source plugs into this app.",
    coverUrl: "https://picsum.photos/seed/libmanou1/400/600",
  },
  {
    title: "Notes on an Imaginary Library",
    author: "Manou Example",
    category: 2,
    language: "eng",
    description: "A second placeholder title, so search results and pagination have more than one item to show.",
    coverUrl: "https://picsum.photos/seed/libmanou2/400/600",
  },
];

// Every book here points at the same small, real, public sample PDF (W3C's well-known test
// file) so the "download" button genuinely works if you tap it while trying this out — a real
// source would put its own per-book file URLs here instead.
const SAMPLE_PDF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

function matches(book, query) {
  // Word-based, like a real search API would behave (not a strict whole-phrase substring) —
  // every word in the query must appear somewhere in the title or author.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${book.title} ${book.author}`.toLowerCase();
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

// Search by free-text query. A real source would build a URL and call
// cachedFetchJson(event, url, fetchJson) here instead.
async function libmanouSearch(event, query, pageToken) {
  const results = FAKE_CATALOG.filter((b) => matches(b, query));
  return { results, next: null }; // only ever one "page" since the fake catalog is tiny
}

// Browse by one of LIBMANOU_CATEGORIES above.
async function libmanouBrowseCategory(event, category, pageToken) {
  const catId = Number(Object.keys(LIBMANOU_CATEGORIES).find((id) => LIBMANOU_CATEGORIES[id] === category));
  const results = FAKE_CATALOG.filter((b) => b.category === catId);
  return { results, next: null };
}

// The short "Title — Author" line shown in search/browse result lists.
function libmanouDisplayLine(book) {
  return `${book.title}  —  ${book.author}`;
}

// Converts one raw catalog entry into the unified book shape the rest of the app expects.
async function libmanouBuildBook(book) {
  return {
    title: book.title,
    author: book.author,
    cover_url: book.coverUrl,
    download_url: SAMPLE_PDF_URL,
    download_url_pdf: SAMPLE_PDF_URL,
    download_url_epub: null,
    description: book.description,
    language: book.language,
    source: "libmanou (example source)",
  };
}

module.exports = {
  name: "libmanou (example source)",
  categories: LIBMANOU_CATEGORIES,
  browseCategory: libmanouBrowseCategory,
  search: libmanouSearch,
  displayLine: libmanouDisplayLine,
  buildBook: libmanouBuildBook,
};
