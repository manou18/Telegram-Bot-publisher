// Shared between openlibrary.js and archiveEdu.js — both ultimately serve files hosted on
// archive.org, so they share the same "fetch this scan's files" and "try several editions
// until one has a usable file" logic.

const { fetchJson } = require("./_http");

async function fetchArchiveInfo(iaId, extensions) {
  const data = await fetchJson(`https://archive.org/metadata/${iaId}`);
  const found = {};
  extensions.forEach((ext) => (found[ext] = null));

  const isRestricted = String((data.metadata || {})["access-restricted-item"]).toLowerCase() === "true";
  if (!isRestricted) {
    for (const f of data.files || []) {
      const name = f.name || "";
      const lower = name.toLowerCase();
      const size = Number(f.size);
      for (const ext of extensions) {
        if (!found[ext] && lower.endsWith(ext)) {
          if (Number.isFinite(size) && size > 0 && size < MIN_PLAUSIBLE_BOOK_BYTES) continue; // skip DRM/placeholder stub
          found[ext] = `https://archive.org/download/${iaId}/${name}`;
        }
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

  return { files: found, description: description || null, language: meta.language || null };
}

// Open Library's search doc can list more than one archive.org scan under "ia" (different
// print editions of the same work). We used to only ever check ia[0] — if that particular
// copy turned out to be borrow-only/restricted, the whole book showed with no download
// link even when a second or third scan on the list was perfectly downloadable. This tries
// each one in order and stops at the first with an actual file, so a restricted first copy
// no longer hides a usable one further down the list. Capped at 5 to bound how many extra
// archive.org requests one search result can trigger.
const MAX_EDITIONS_TO_TRY = 5;

async function findUsableArchiveCopy(iaIds, extensions) {
  let lastInfo = null;
  let lastIaId = null;
  for (const iaId of iaIds.slice(0, MAX_EDITIONS_TO_TRY)) {
    let info;
    try {
      info = await fetchArchiveInfo(iaId, extensions);
    } catch (e) {
      console.error(`Failed to check archive.org copy ${iaId}:`, e.message);
      continue;
    }
    if (!lastInfo) {
      lastInfo = info;
      lastIaId = iaId;
    }
    if (extensions.some((ext) => info.files[ext])) {
      return { iaId, info };
    }
  }
  // Nothing had a direct file — still return the first copy we successfully looked up, so
  // its cover/description can be used and the caller has an archive.org id to link to.
  return lastInfo ? { iaId: lastIaId, info: lastInfo } : null;
}

module.exports = { fetchArchiveInfo, findUsableArchiveCopy };
