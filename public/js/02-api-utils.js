// === 02: Small pure helpers (rating/text scoring, file-size formatting) + the fetch layer ===
// (jsonFetch, the year-long localStorage cache from cachedJsonFetch) + loadSources/loadCategories/setMode/renderResults.

function effectiveRating(r) {
  return r.rating || r.source_rating || 0;
}

// ---- Search relevance ------------------------------------------------------------------
// Every source's displayLine() is built the same way: `${title}  —  ${authors}` (see
// netlify/lib/sources.js), so we can split it back apart client-side without needing a
// separate title/author field from the API. Used only to rank an already-fetched result
// list against what the user actually typed — it never filters anything out, since a
// source's own search can be relevant even when it doesn't literally contain the query text.
function splitTitleAuthor(line) {
  const parts = String(line || "").split(/\s+—\s+/);
  return { title: parts[0] || "", author: parts.slice(1).join(" — ") || "" };
}

// Lowercases, strips Arabic diacritics/tatweel and normalizes different Alef/Yaa/Taa
// Marbuta forms so "أحمد" and "احمد" (or "دِيوان" and "ديوان") compare as equal, then
// strips punctuation and collapses whitespace. Also folds Latin text to lowercase and
// strips accents the same way, so this one function works for both scripts.
function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Latin diacritics/accents
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // Arabic tashkeel + tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// How well one field (title or author) matches the query: exact match scores highest,
// then "field starts with query" / "query starts with field", then substring containment,
// then partial credit for the fraction of query words that appear in the field. Returns 0
// when nothing in the query relates to the field at all.
function fieldMatchScore(query, field) {
  if (!query || !field) return 0;
  if (field === query) return 1000;
  if (field.startsWith(query) || query.startsWith(field)) return 700;
  if (field.includes(query)) return 500;
  const queryWords = query.split(" ").filter(Boolean);
  if (!queryWords.length) return 0;
  const fieldWords = new Set(field.split(" ").filter(Boolean));
  const matched = queryWords.filter((w) => fieldWords.has(w)).length;
  return matched ? Math.round(200 * (matched / queryWords.length)) : 0;
}

// Combined relevance of one result row against the current search text: the better of its
// title-match and author-match scores (a title search and an author search both go through
// this same scoring, whichever field the query actually matches).
function relevanceScore(query, line) {
  if (!query) return 0;
  const { title, author } = splitTitleAuthor(line);
  return Math.max(
    fieldMatchScore(query, normalizeSearchText(title)),
    fieldMatchScore(query, normalizeSearchText(author))
  );
}

// Applies the active rating filter (and, for the Saved tab, the title/author search box)
// to a results list. Shared by renderResults() and the bulk "select all" handler so both
// always agree on exactly which rows are "visible".
function applyRatingFilter(results) {
  let filtered = results;
  if (ratingFilter === "rated") filtered = filtered.filter((r) => r.rating);
  else if (ratingFilter === "top") filtered = filtered.filter((r) => effectiveRating(r) >= 4);
  else if (ratingFilter === "unrated") filtered = filtered.filter((r) => !r.rating);
  return filtered;
}

// Telegram bots can't upload files bigger than this via the direct-upload fallback
// (see netlify/lib/telegram.js) — warn about it in the preview instead of letting the
// publish attempt fail after the fact.
const TELEGRAM_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

let bulkSelected = new Set(); // references into lastResults — which saved books are checked
                               // for bulk publishing (Saved Books tab only)

const SITE_PASSWORD_STORAGE_KEY = "sitePassword";
let sitePassword = null; // sent as X-Site-Password on every /api/* request once verified

function formatFileSize(bytes) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function updateFileSizeDisplay() {
  const bytes = selectedFileType ? fileSizes[selectedFileType] : null;
  const formatted = formatFileSize(bytes);
  if (!formatted) {
    previewFileSize.classList.add("hidden");
    previewFileSize.textContent = "";
  } else {
    const label = selectedFileType ? selectedFileType.toUpperCase() : "";
    previewFileSize.textContent = `📦 Size: ${formatted}${fileTypeChoice.classList.contains("hidden") ? "" : ` (${label})`}`;
    previewFileSize.classList.remove("hidden");
  }

  // Telegram rejects files at/over 50MB outright — flag it here, before the user clicks
  // Publish and finds out from a failed request instead. When that happens, offer a
  // direct "download locally" link so the file can still be grabbed and published to the
  // channel by hand later (outside this tool, e.g. via Telegram Desktop).
  if (bytes && bytes >= TELEGRAM_MAX_UPLOAD_BYTES) {
    previewFileSizeWarning.textContent =
      `⚠️ This file is ${formatFileSize(bytes)}, which is at or over Telegram's 50 MB bot upload limit. The bot will likely reject it — download it below and publish it manually instead.`;
    previewFileSizeWarning.classList.remove("hidden");

    const url = selectedFileType ? downloadUrls[selectedFileType] : null;
    if (url) {
      downloadLocalBtn.href = url;
      // The button previously just navigated to the archive.org file URL. For files this
      // large (100MB+), Chrome tries to load/render it inline first and can sit on a
      // blank tab for a long time before anything happens, which reads as "not working".
      // The `download` attribute forces an immediate real download (progress shown in the
      // browser's download notification/tray) instead of a page navigation attempt.
      const ext = selectedFileType === "epub" ? "epub" : "pdf";
      const safeTitle = (previewTitle.textContent || "book").trim().replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) || "book";
      downloadLocalBtn.setAttribute("download", `${safeTitle}.${ext}`);
      downloadLocalBtn.classList.remove("hidden");
      downloadLocalHint.classList.remove("hidden");
    } else {
      downloadLocalBtn.classList.add("hidden");
      downloadLocalBtn.removeAttribute("download");
      downloadLocalHint.classList.add("hidden");
    }
  } else {
    previewFileSizeWarning.textContent = "";
    previewFileSizeWarning.classList.add("hidden");
    downloadLocalBtn.classList.add("hidden");
    downloadLocalBtn.removeAttribute("href");
    downloadLocalHint.classList.add("hidden");
  }
}

// Read-only: shows the book's real reader rating from its source when one exists (Open
// Library / Google Books, when readers have actually rated that book there). Every other
// source — and books with no reader ratings — simply show nothing here; there's no manual
// rating step to fall back to.
function renderSourceRating() {
  if (typeof currentSourceRating === "number" && currentSourceRating > 0) {
    const display = Number.isInteger(currentSourceRating)
      ? String(currentSourceRating)
      : currentSourceRating.toFixed(1);
    previewSourceRating.textContent = `⭐ ${display}/5 reader rating`;
    previewSourceRating.classList.remove("hidden");
  } else {
    previewSourceRating.textContent = "";
    previewSourceRating.classList.add("hidden");
  }
}

async function jsonFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (sitePassword) headers["X-Site-Password"] = sitePassword;
  const r = await fetch(url, { ...opts, headers });
  // The function can come back with an empty/cut-off body — most commonly because the
  // request ran past Netlify's function execution time limit and got killed mid-response
  // (seen with slow upstream sources on very large categories) — in which case r.json()
  // itself throws a cryptic "Unexpected end of JSON input" instead of the actual problem.
  // Reading as text first and parsing manually lets us tell the person what really
  // happened instead of surfacing that raw parser error.
  const raw = await r.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    throw new Error(
      r.ok
        ? "The server's response was cut off before finishing (likely a timeout on a slow/large request) — try again, or a smaller category/page."
        : `Request failed (HTTP ${r.status}) and returned no readable error message.`
    );
  }
  if (!r.ok) throw new Error(data.error || "An unexpected error occurred");
  return data;
}

// A local (browser-side) cache for /api/sources and /api/categories — unlike Browse/Search
// results, the source list and each source's category list are hardcoded in sources.js on
// the server and never change on their own, so there's no reason to re-invoke a Netlify
// function for them on every single page load. Mirrors the server's own http-cache.js:
// keyed by a SHA-256 hash of the exact request URL, value is { fetchedAt, data }. Kept for
// a year — effectively "until the site owner's browser storage is cleared or the code that
// defines the sources/categories actually changes" — since this only lives in the site
// owner's own localStorage, not shared with anyone else and not counted against Netlify's
// function-invocation or Blobs usage at all.
const LOCAL_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function localCacheKey(hash) {
  return `hcache:${hash}`;
}

function readLocalCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted entry — treat as a miss rather than throwing
  }
}

function writeLocalCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch (e) {
    // Quota exceeded or storage disabled (private browsing, etc.) — caching is an
    // optimization, not a requirement, so just skip persisting and move on silently.
    console.error("local cache write failed:", e.message);
  }
}

// fetcher: an async () => data function, exactly like jsonFetch's return value — pass
// () => jsonFetch(url). Returns straight from localStorage when a cached copy under a
// year old exists, otherwise fetches live and caches the result; if the live fetch fails
// but a cached copy (of any age) exists, falls back to that stale copy rather than
// breaking the login screen entirely over what's normally static data.
async function cachedJsonFetch(url, fetcher) {
  const key = localCacheKey(await sha256Hex(url));
  const cached = readLocalCache(key);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < LOCAL_CACHE_MAX_AGE_MS) {
    return cached.data;
  }

  try {
    const data = await fetcher();
    writeLocalCache(key, data);
    return data;
  } catch (e) {
    if (cached) {
      console.error(`Live fetch failed for ${url}, serving locally cached copy instead:`, e.message);
      return cached.data;
    }
    throw e;
  }
}

async function loadSources() {
  const sources = await cachedJsonFetch("/api/sources", () => jsonFetch("/api/sources"));
  realSourceIds = sources.map((s) => s.id);
  const placeholder = `<option value="" disabled selected>— Choose a source —</option>`;
  const allOption = `<option value="${ALL_SOURCES_ID}">🌐 All Sources (search only)</option>`;
  const realOptions = sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  sourceSelect.innerHTML = placeholder + allOption + realOptions;
  // No source is auto-selected and no category list is loaded yet — the catalog starts
  // empty until the user actually picks a source (see unlockApp()), instead of always
  // defaulting to — and immediately browsing — the first source in the list.
  categorySelect.innerHTML = "";
}

async function loadCategories() {
  const url = `/api/categories?source=${sourceSelect.value}`;
  const cats = await cachedJsonFetch(url, () => jsonFetch(url));
  categorySelect.innerHTML = cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

// ---- Multi-channel publishing --------------------------------------------------------
// The site can be configured (via TELEGRAM_CHANNELS, see lib/channels.js) with more than
// one Telegram destination. When that's the case, a "Publish to" checklist appears above
// the tabs and every Publish/Schedule/Queue action below sends whichever channel ids are
// currently checked. Not cached locally like sources/categories — the site owner may
// change TELEGRAM_CHANNELS at any time and this list is small/cheap to re-fetch.
let availableChannels = []; // [{id, name, categories, default}], from /api/channels
let selectedChannelIds = new Set(); // currently checked channel ids

async function loadChannels() {
  try {
    availableChannels = await jsonFetch("/api/channels");
  } catch (e) {
    availableChannels = []; // fails safe — falls back to single/default-channel behavior
  }
  renderChannelChecklist();
}

function renderChannelChecklist() {
  // Fewer than 2 channels configured — nothing meaningful to choose between, so keep the
  // picker hidden and let the backend's own default/category fallback decide, exactly
  // like before this feature existed.
  if (availableChannels.length < 2) {
    channelField.classList.add("hidden");
    channelChecklist.innerHTML = "";
    selectedChannelIds = new Set();
    return;
  }

  // Pre-check the channel(s) flagged default:true the first time the list loads, so
  // publishing without touching this widget still goes somewhere sensible.
  if (!selectedChannelIds.size) {
    availableChannels.filter((c) => c.default).forEach((c) => selectedChannelIds.add(c.id));
  }

  channelField.classList.remove("hidden");
  channelChecklist.innerHTML = availableChannels
    .map(
      (c) =>
        `<label class="channel-check-item"><input type="checkbox" value="${c.id}" ${
          selectedChannelIds.has(c.id) ? "checked" : ""
        } /><span>${c.name}</span></label>`
    )
    .join("");
  channelChecklist.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) selectedChannelIds.add(box.value);
      else selectedChannelIds.delete(box.value);
    });
  });
}

// The value to send as "channels" in a publish/schedule/queue-add request body — null
// when there's nothing meaningful to send (fewer than 2 channels configured), so the
// backend's own category/default fallback decides exactly as it did before this feature.
function getSelectedChannelIds() {
  return selectedChannelIds.size ? Array.from(selectedChannelIds) : null;
}

// Turns a record's stored channel ids back into readable names for display in the
// Scheduled/Queue tabs — e.g. "📡 Fiction, Non-fiction". Empty for records that didn't
// pin specific channels (they'll resolve via category/default when they actually publish).
function channelNamesLabel(ids) {
  if (!Array.isArray(ids) || !ids.length || availableChannels.length < 2) return "";
  const byId = new Map(availableChannels.map((c) => [c.id, c.name]));
  return ids.map((id) => byId.get(id) || id).join(", ");
}


function setMode(newMode) {
  mode = newMode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  sourceField.classList.toggle("hidden", mode === "collection" || mode === "saved" || mode === "scheduled" || mode === "queue" || mode === "manual" || mode === "mockup" || mode === "copyright" || mode === "watermark" || mode === "compress" || mode === "crop" || mode === "tgpreview");
  categoryField.classList.toggle("hidden", mode !== "browse");
  searchField.classList.toggle("hidden", mode !== "search");
  collectionField.classList.toggle("hidden", mode !== "collection");
  savedSearchInput.classList.toggle("hidden", mode !== "saved");
  ratingFilterSelect.parentElement.classList.toggle("hidden", mode === "scheduled" || mode === "queue" || mode === "manual" || mode === "mockup" || mode === "copyright" || mode === "watermark" || mode === "compress" || mode === "crop" || mode === "tgpreview");
  queueSettingsBar.classList.toggle("hidden", mode !== "queue");
  manualField.classList.toggle("hidden", mode !== "manual");
  mockupField.classList.toggle("hidden", mode !== "mockup");
  copyrightField.classList.toggle("hidden", mode !== "copyright");
  watermarkField.classList.toggle("hidden", mode !== "watermark");
  compressField.classList.toggle("hidden", mode !== "compress");
  cropField.classList.toggle("hidden", mode !== "crop");
  tgPreviewField.classList.toggle("hidden", mode !== "tgpreview");
  resultsWrap.classList.toggle("hidden", mode === "manual" || mode === "mockup" || mode === "copyright" || mode === "watermark" || mode === "compress" || mode === "crop" || mode === "tgpreview");
  if (mode !== "saved") savedSearchInput.value = "";
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
  nextToken = null;
  currentSearchQuery = "";
  lastResults = [];
  bulkSelected = new Set();
  bulkPublishBar.classList.add("hidden");
  bulkPublishStatus.classList.add("hidden");
  bulkPublishStatus.textContent = "";
  bulkScheduleDateTime.value = "";
  bulkQueueForce.checked = false;
}

function renderResults(results) {
  lastResults = results;
  resultsList.innerHTML = "";

  let filtered = applyRatingFilter(results);

  if (mode === "saved") {
    const q = savedSearchInput.value.trim().toLowerCase();
    if (q) filtered = filtered.filter((r) => r.line.toLowerCase().includes(q));
  }

  if (!filtered.length) {
    statusLine.textContent = results.length ? "No results match this filter." : "No results.";
    return;
  }

  // When this list came from an actual title/author search, rank by how well each row
  // matches what was typed FIRST, before rating — otherwise a highly-rated but unrelated
  // book (or another author's book that merely shares a word) could outrank the very book
  // being searched for. Browse/Collection/Saved lists have no search text, so they keep the
  // old rating-only order untouched.
  const query = mode === "search" ? normalizeSearchText(currentSearchQuery) : "";
  let relevanceOf = null;
  let topAuthor = null;
  if (query) {
    relevanceOf = new Map(filtered.map((r) => [r, relevanceScore(query, r.line)]));
    const best = filtered.reduce(
      (top, r) => ((relevanceOf.get(r) || 0) > (relevanceOf.get(top) || -1) ? r : top),
      filtered[0]
    );
    if (best && relevanceOf.get(best) > 0) topAuthor = normalizeSearchText(splitTitleAuthor(best.line).author);
  }
  // Once we know which author the best-matching row belongs to, every other row by that
  // same author (the rest of their bibliography) gets a flat bonus — enough to rank above
  // unrelated results, but below anything that still matches the query text directly.
  const authorBonusOf = (r) => {
    if (!topAuthor) return 0;
    const { author } = splitTitleAuthor(r.line);
    return normalizeSearchText(author) === topAuthor ? 250 : 0;
  };

  // Books you already published rank first (highest rating first, since that's a rating
  // you personally vetted). Among everything else, books with a real reader rating from
  // their source (Open Library / Google Books) rank next, highest first — so the better
  // options surface before you even open them. Everything with neither keeps its original
  // order at the bottom.
  const sorted = filtered
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => {
      if (query) {
        const relDiff =
          (relevanceOf.get(b.r) || 0) + authorBonusOf(b.r) - ((relevanceOf.get(a.r) || 0) + authorBonusOf(a.r));
        if (relDiff) return relDiff;
      }
      return (
        (b.r.rating || 0) - (a.r.rating || 0) ||
        (b.r.source_rating || 0) - (a.r.source_rating || 0) ||
        a.idx - b.idx
      );
    })
    .map(({ r }) => r);

  statusLine.textContent = `${sorted.length} result${sorted.length === 1 ? "" : "s"}`;

  const bulkMode = mode === "saved";
  bulkPublishBar.classList.toggle("hidden", !bulkMode || !sorted.length);
  if (bulkMode) updateBulkControls(sorted);

  sorted.forEach((r) => {
    const li = document.createElement("li");
    // Published rating (stars) takes priority in the row text; for anything not yet
    // published, fall back to showing the source's reader rating as a plain number badge
    // so it's visually distinct from a rating you gave yourself.
    let text = r.line;
    if (r.rating) {
      text = `${"⭐".repeat(Math.round(r.rating))} ${r.line}`;
    } else if (r.source_rating) {
      const display = Number.isInteger(r.source_rating) ? String(r.source_rating) : r.source_rating.toFixed(1);
      text = `📖${display} ${r.line}`;
    }

    if (bulkMode) {
      li.classList.add("bulk-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "bulk-checkbox";
      checkbox.checked = bulkSelected.has(r);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) bulkSelected.add(r);
        else bulkSelected.delete(r);
        updateBulkControls(sorted);
      });
      const span = document.createElement("span");
      span.className = "bulk-row-text";
      span.textContent = text;
      span.addEventListener("click", () => openPreview(r.item, r.source, r.category || null));
      li.appendChild(checkbox);
      li.appendChild(span);
    } else {
      li.textContent = text;
      li.addEventListener("click", () => openPreview(r.item, r.source, r.category || null));
    }
    resultsList.appendChild(li);
  });
}

// Keeps the "Select all" checkbox, the selected count, and the Publish button's
// enabled state in sync with bulkSelected — called whenever a checkbox changes or the
// list re-renders. `visible` is the currently displayed (filtered/sorted) row set.
function updateBulkControls(visible) {
  const selectedVisible = visible.filter((r) => bulkSelected.has(r));
  bulkSelectedCount.textContent = `${selectedVisible.length} selected`;
  bulkPublishBtn.disabled = selectedVisible.length === 0;
  bulkScheduleBtn.disabled = selectedVisible.length === 0;
  bulkQueueBtn.disabled = selectedVisible.length === 0;
  bulkSelectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
}

ratingFilterSelect.addEventListener("change", () => {
  ratingFilter = ratingFilterSelect.value;
  renderResults(lastResults); // re-apply without re-fetching — we already have the data
});
savedSearchInput.addEventListener("input", () => {
  renderResults(lastResults); // filters the already-loaded saved list, no re-fetch needed
});

