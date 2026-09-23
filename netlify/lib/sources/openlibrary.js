// ==========================================================
//  Source 2: Open Library / Internet Archive
// ==========================================================

const { fetchJson, cachedFetchJson } = require("./_http");
const { findUsableArchiveCopy } = require("./_archiveHelpers");

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
  11: "education",
};

async function openlibraryBrowseCategory(event, subject, offsetToken) {
  const offset = offsetToken ? parseInt(offsetToken, 10) : 0;
  const url = `https://openlibrary.org/subjects/${subject}.json?limit=10&offset=${offset}`;
  const data = await cachedFetchJson(event, url, fetchJson);
  const works = data.works || [];
  const total = data.work_count || 0;
  const nextOffset = offset + 10 < total ? offset + 10 : null;
  return { results: works, next: nextOffset !== null ? String(nextOffset) : null };
}

async function openlibrarySearch(event, query, pageToken) {
  const page = pageToken ? parseInt(pageToken, 10) : 1;
  // fields=*,ratings_average,ratings_count — the default field set doesn't include reader
  // ratings, so they have to be requested explicitly to know when a real rating exists.
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
    query
  )}&limit=10&page=${page}&fields=*,ratings_average,ratings_count`;
  const data = await cachedFetchJson(event, url, fetchJson);
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

// Shared with openlibrarySourceRating() below — pulls the real reader rating out of a
// raw Open Library doc when one exists, so both the full book detail and the lightweight
// browse/search list rows use the exact same rule for what counts as "rated".
function openlibraryExtractRating(doc) {
  const count = typeof doc.ratings_count === "number" ? doc.ratings_count : null;
  const average = typeof doc.ratings_average === "number" ? doc.ratings_average : null;
  return { rating: count ? average : null, count };
}

// Cheap, synchronous — reads straight off the search.json doc (already fetched for the
// list), no extra request. Used to sort/display reader ratings in Browse/Search results
// before a book is even opened. Only openlibrarySearch requests the ratings_average/
// ratings_count fields, so subject-browse rows have nothing to show here (see openlibraryBrowseCategory).
function openlibrarySourceRating(doc) {
  return openlibraryExtractRating(doc).rating;
}

async function openlibraryBuildBook(doc) {
  const title = doc.title;
  let author;
  if (doc.authors) author = (doc.authors || []).map((a) => a.name || "").join(", ") || "Unknown";
  else author = (doc.author_name || []).join(", ") || "Unknown";

  let iaIds = [];
  if (Array.isArray(doc.ia)) iaIds = doc.ia.filter(Boolean);
  else if (typeof doc.ia === "string" && doc.ia) iaIds = [doc.ia];

  let downloadUrlPdf = null;
  let downloadUrlEpub = null;
  let coverUrl = null;
  let description = null;
  let usedIaId = null;
  let language = null;

  if (iaIds.length) {
    const found = await findUsableArchiveCopy(iaIds, [".pdf", ".epub"]);
    if (found) {
      usedIaId = found.iaId;
      language = found.info.language || null;
      downloadUrlPdf = found.info.files[".pdf"];
      downloadUrlEpub = found.info.files[".epub"];
      coverUrl = `https://archive.org/services/img/${found.iaId}`;
      description = found.info.description;
    }
  } else if (doc.cover_i) {
    coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }

  if (!description) {
    description = await openlibraryFetchDescription(doc);
  }

  // A real reader rating from Open Library — only present when readers have actually rated
  // the book there (e.g. via search.json's ratings_average/ratings_count fields, requested
  // explicitly above). Browsing by subject doesn't expose these fields at all, so books
  // reached that way simply won't have a source_rating, same as if OL had none for them.
  const { rating: sourceRating, count: sourceRatingCount } = openlibraryExtractRating(doc);

  return {
    title,
    author,
    cover_url: coverUrl,
    download_url: downloadUrlPdf || downloadUrlEpub || null,
    download_url_pdf: downloadUrlPdf,
    download_url_epub: downloadUrlEpub,
    description,
    language, // archive.org's own language tag for the scan we picked (used by the bot's English-only filter)
    source: "Open Library / Internet Archive",
    source_rating: sourceRating,
    source_rating_count: sourceRatingCount,
    // Fallback link for when none of the scanned copies had a downloadable file: the
    // archive.org item page if we found one at all, otherwise the Open Library work page —
    // either way the user has somewhere to click instead of a dead end.
    source_url: !(downloadUrlPdf || downloadUrlEpub)
      ? usedIaId
        ? `https://archive.org/details/${usedIaId}`
        : doc.key
        ? `https://openlibrary.org${doc.key}`
        : null
      : null,
  };
}

module.exports = {
  name: "Open Library / Internet Archive",
  categories: OPENLIBRARY_CATEGORIES,
  browseCategory: openlibraryBrowseCategory,
  search: openlibrarySearch,
  displayLine: openlibraryDisplayLine,
  buildBook: openlibraryBuildBook,
  sourceRating: openlibrarySourceRating,
};
