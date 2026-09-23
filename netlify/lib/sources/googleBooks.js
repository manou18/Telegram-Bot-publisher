// ==========================================================
// Source 5: Google Books — public-domain/full-view books only
// The Google Books API exposes public volume metadata without authentication.
// We deliberately use filter=full and only publish direct download links when
// Google marks the volume as public domain / full public access.
// ==========================================================

const { fetchJson, cachedFetchJson } = require("./_http");

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

async function googleBooksSearch(event, query, pageToken) {
  const startIndex = pageToken ? parseInt(pageToken, 10) : 0;
  // Keyless requests to Google Books are metered against ONE shared quota bucket used by
  // every anonymous caller on the internet (not per-IP) — it's usually already exhausted,
  // which is why this source tends to fail with a 429 regardless of how lightly *we* use
  // it. Setting GOOGLE_BOOKS_API_KEY (see README) moves requests onto your own free-tier
  // quota instead; without it, we still work, just subject to that shared limit.
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}` +
    `&filter=full&maxResults=10&startIndex=${startIndex}` +
    (apiKey ? `&key=${encodeURIComponent(apiKey)}` : "");
  const data = await cachedFetchJson(event, url, fetchJson);
  const results = data.items || [];
  const total = data.totalItems || 0;
  const next = startIndex + results.length < total && results.length
    ? String(startIndex + results.length)
    : null;
  return { results, next };
}

async function googleBooksBrowseCategory(event, topic, pageToken) {
  return googleBooksSearch(event, `subject:${topic}`, pageToken);
}

function googleBooksDisplayLine(item) {
  const info = item.volumeInfo || {};
  const authors = (info.authors || []).join(", ") || "Unknown";
  return `${info.title || "Untitled"}  —  ${authors}`;
}

// Shared with googleBooksSourceRating() below — same reasoning as Open Library's helper.
function googleBooksExtractRating(info) {
  const count = typeof info.ratingsCount === "number" ? info.ratingsCount : null;
  const average = typeof info.averageRating === "number" ? info.averageRating : null;
  return { rating: count ? average : null, count };
}

// Cheap, synchronous — reads straight off the volume item already returned by the list
// endpoint (search or category browse both include volumeInfo.averageRating/ratingsCount
// by default), no extra request needed.
function googleBooksSourceRating(item) {
  return googleBooksExtractRating(item.volumeInfo || {}).rating;
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

  // A real reader rating from Google Books — averageRating (1-5) is only present when
  // ratingsCount is greater than zero; volumes with no reader ratings omit both fields.
  const { rating: sourceRating, count: sourceRatingCount } = googleBooksExtractRating(info);

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
    source_rating: sourceRating,
    source_rating_count: sourceRatingCount,
  };
}

module.exports = {
  name: "Google Books — Public Domain",
  categories: GOOGLE_BOOKS_CATEGORIES,
  browseCategory: googleBooksBrowseCategory,
  search: googleBooksSearch,
  displayLine: googleBooksDisplayLine,
  buildBook: googleBooksBuildBook,
  sourceRating: googleBooksSourceRating,
};
