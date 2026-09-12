// "Manual entry" books have no external source to fetch from — the item the frontend
// sends already carries every field (title, author, description, cover_url, download_url,
// fileType) directly, instead of a lookup reference a source's buildBook() would resolve.
// This builds the same book shape every real source's buildBook(item) returns, so a
// manually-entered book can be saved for later, scheduled, previewed, and published
// through the exact same endpoints (save.js, schedule.js, preview.js, publish.js) as a
// book found by browsing/searching — no special-casing needed beyond picking this builder
// instead of SOURCES[sourceId].buildBook when sourceId is "manual".
//
// Not registered in lib/sources.js's SOURCES map on purpose — it has no
// categories/search/browseCategory, so it must never appear in the source-selector
// dropdown. bookIdentity.js's getStableId() already has a "manual" case (title+author,
// lowercased) used by the publish log; saved/scheduled records reuse that same identity.
const MANUAL_SOURCE_ID = "manual";

function buildManualBook(item) {
  const title = (item && item.title && String(item.title).trim()) || "";
  const author = (item && item.author && String(item.author).trim()) || "Unknown";
  const coverUrl = (item && item.cover_url) || null;
  const downloadUrl = (item && item.download_url) || null;
  const fileType = item && item.fileType;
  return {
    title,
    author,
    description: item && typeof item.description === "string" && item.description.trim() ? item.description.trim() : null,
    cover_url: coverUrl,
    download_url: downloadUrl,
    download_url_pdf: downloadUrl && fileType !== "epub" ? downloadUrl : null,
    download_url_epub: downloadUrl && fileType === "epub" ? downloadUrl : null,
    source: "Manual Entry",
    source_rating: null,
  };
}

module.exports = { buildManualBook, MANUAL_SOURCE_ID };
