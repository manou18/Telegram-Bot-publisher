// ==========================================================
//  Source 4: OAPEN — open-access academic books
// ==========================================================
// The OAPEN Library is built on DSpace 5, and offers a public JSON REST API with no
// access key needed: https://library.oapen.org/rest/search?query=...&expand=metadata,bitstreams
// The response is a plain array of items (no pagination wrapper), so we simulate
// pagination ourselves via limit/offset and assume a next page exists if the result
// count equals the limit. The "categories" here are effectively the platform's biggest
// publishers (real data from the oapen.org API) since subject classification lists
// (BIC/Thema) aren't published as stable values that can be reliably relied on for
// filtering directly via the API.

const { fetchJson, cachedFetchJson } = require("./_http");

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

async function oapenSearchRaw(event, queryString, pageToken) {
  const limit = 10;
  const offset = pageToken ? parseInt(pageToken, 10) : 0;
  const url = `${OAPEN_BASE}/rest/search?query=${encodeURIComponent(
    queryString
  )}&expand=metadata,bitstreams&limit=${limit}&offset=${offset}`;
  const data = await cachedFetchJson(event, url, fetchJson);
  const results = Array.isArray(data) ? data : [];
  const next = results.length === limit ? String(offset + limit) : null;
  return { results, next };
}

// A DSpace 5 item's own UUID, wherever it shows up on the record. OAPEN's REST API docs
// point at a "uuid" field, but since we can't be 100% sure of the exact casing/location on
// every record shape, we also fall back to scanning the metadata for anything that's
// shaped like a UUID before giving up.
function oapenExtractUuid(entity) {
  if (!entity) return null;
  if (typeof entity.uuid === "string") return entity.uuid;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const m of entity.metadata || []) {
    if (typeof m.value === "string" && uuidPattern.test(m.value)) return m.value;
  }
  return null;
}

// Per OAPEN's own REST API docs (oapen.org/article/8185269), querying `publisher.name:"X"`
// does NOT return that publisher's books — it returns the publisher's own entity record,
// which carries a repeated "oapen.relation.isPublisherOf" field listing every book it's
// ever published, with no details attached. For a large publisher (e.g. Springer Nature,
// with thousands of titles) that field alone can be big enough that the response gets cut
// off mid-transfer — this is exactly what caused the "Unexpected end of JSON input" error
// when browsing Springer Nature specifically (smaller publishers didn't trip it).
//
// The fix: a DSpace 5 item/community record already carries its own "uuid" as a plain
// top-level field — we don't need `expand=metadata` at all to read it, and that parameter
// is precisely what pulls in the giant isPublisherOf list in the first place. So the normal
// path here never requests metadata. Only if a candidate result is missing a top-level uuid
// (some unexpected record shape) do we fall back to a single metadata-expanded re-fetch for
// that one entity, keeping the same safety net as before without paying its cost every time.
async function oapenResolvePublisherUuid(event, publisherName) {
  const url = `${OAPEN_BASE}/rest/search?query=${encodeURIComponent(
    `publisher.name:"${publisherName}"`
  )}&limit=5&offset=0`;
  const data = await cachedFetchJson(event, url, fetchJson);
  const results = Array.isArray(data) ? data : [];
  for (const entity of results) {
    const uuid = oapenExtractUuid(entity);
    if (uuid) return uuid;
    // Fallback for the rare record with no top-level uuid: re-fetch just this one entity
    // with metadata expanded, so a genuinely large publisher isn't punished for a shape
    // quirk on some other unrelated result.
    if (entity && entity.link) {
      try {
        const expanded = await fetchJson(`${OAPEN_BASE}${entity.link}?expand=metadata`);
        const fallbackUuid = oapenExtractUuid(expanded);
        if (fallbackUuid) return fallbackUuid;
      } catch (e) {
        console.error(`Failed to resolve UUID via metadata fallback for ${publisherName}:`, e.message);
      }
    }
  }
  return null;
}

async function oapenBrowseCategory(event, publisherName, pageToken) {
  // The resolved UUID is cheap to look up (a small, single-record response) and gets its
  // own cache entry via cachedFetchJson, so repeat browses of the same publisher/category
  // don't pay for this extra round-trip beyond the first time within the cache window.
  const uuid = await oapenResolvePublisherUuid(event, publisherName);
  if (!uuid) return { results: [], next: null };
  return oapenSearchRaw(event, `oapen.relation.isPublishedBy:"${uuid}"`, pageToken);
}

async function oapenSearch(event, query, pageToken) {
  return oapenSearchRaw(event, query, pageToken);
}

function oapenAuthors(item) {
  const authors = oapenMetaValues(item.metadata, "dc.contributor.author");
  return authors.length ? authors.join(", ") : "Unknown";
}

// Whether this item has an actual PDF hosted on OAPEN itself. Some aggregated publishers
// (particularly large commercial ones) only let OAPEN index their metadata, with the real
// file living on the publisher's own site — those records are entirely legitimate, but
// there's nothing to publish directly. `expand=bitstreams` is already part of every OAPEN
// list request (see oapenSearchRaw), so this is free — no extra request needed.
function oapenHasDirectFile(item) {
  return (item.bitstreams || []).some(
    (b) => b.bundleName === "ORIGINAL" && (b.mimeType === "application/pdf" || /\.pdf$/i.test(b.name || ""))
  );
}

function oapenDisplayLine(item) {
  const title = oapenMetaValue(item.metadata, "dc.title") || item.name || "Untitled";
  const noFileTag = oapenHasDirectFile(item) ? "" : " 🔒 no direct file";
  return `${title}${noFileTag}  —  ${oapenAuthors(item)}`;
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
    // Fallback for records where OAPEN only indexes the metadata and the real file lives
    // on the publisher's own site (see oapenHasDirectFile above) — send the user to the
    // record's own OAPEN page instead of leaving them with nothing to click.
    source_url: !downloadUrlPdf && item.handle ? `${OAPEN_BASE}/handle/${item.handle}` : null,
  };
}

module.exports = {
  name: "OAPEN — Open-Access Academic Books",
  categories: OAPEN_CATEGORIES,
  browseCategory: oapenBrowseCategory,
  search: oapenSearch,
  displayLine: oapenDisplayLine,
  buildBook: oapenBuildBook,
};
