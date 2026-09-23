// ==========================================================
// Source 6: DOAB — Directory of Open Access Books
// DOAB provides a public REST API for metadata and open-access book files.
// ==========================================================

const { fetchJson, cachedFetchJson } = require("./_http");

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

async function doabSearchRaw(event, queryString, pageToken) {
  const limit = 10;
  const offset = pageToken ? parseInt(pageToken, 10) : 0;
  const url =
    `${DOAB_BASE}/rest/search?query=${encodeURIComponent(queryString)}` +
    `&expand=metadata,bitstreams&limit=${limit}&offset=${offset}`;
  const data = await cachedFetchJson(event, url, fetchJson);
  const results = Array.isArray(data) ? data : [];
  const next = results.length === limit ? String(offset + limit) : null;
  return { results, next };
}

async function doabSearch(event, query, pageToken) {
  return doabSearchRaw(event, query, pageToken);
}

async function doabBrowseCategory(event, topic, pageToken) {
  return doabSearchRaw(event, `"${topic}"`, pageToken);
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

module.exports = {
  name: "DOAB — Open Access Books",
  categories: DOAB_CATEGORIES,
  browseCategory: doabBrowseCategory,
  search: doabSearch,
  displayLine: doabDisplayLine,
  buildBook: doabBuildBook,
};
