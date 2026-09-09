const sourceSelect = document.getElementById("sourceSelect");
const sourceField = document.getElementById("sourceField");
const categorySelect = document.getElementById("categorySelect");
const categoryField = document.getElementById("categoryField");
const searchField = document.getElementById("searchField");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const collectionField = document.getElementById("collectionField");
const collectionInput = document.getElementById("collectionInput");
const collectionBtn = document.getElementById("collectionBtn");
const resultsList = document.getElementById("resultsList");
const statusLine = document.getElementById("statusLine");
const ratingFilterSelect = document.getElementById("ratingFilterSelect");
const savedSearchInput = document.getElementById("savedSearchInput");
const nextPageBtn = document.getElementById("nextPageBtn");
const tabs = document.querySelectorAll(".tab");

const mainCatalog = document.getElementById("mainCatalog");
const loginOverlay = document.getElementById("loginOverlay");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const statsBtn = document.getElementById("statsBtn");
const statsOverlay = document.getElementById("statsOverlay");
const closeStats = document.getElementById("closeStats");
const statsContent = document.getElementById("statsContent");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

const healthBtn = document.getElementById("healthBtn");
const healthOverlay = document.getElementById("healthOverlay");
const closeHealth = document.getElementById("closeHealth");
const healthContent = document.getElementById("healthContent");

const bulkPublishBar = document.getElementById("bulkPublishBar");
const bulkSelectAll = document.getElementById("bulkSelectAll");
const bulkSelectedCount = document.getElementById("bulkSelectedCount");
const bulkPublishBtn = document.getElementById("bulkPublishBtn");
const bulkScheduleDateTime = document.getElementById("bulkScheduleDateTime");
const bulkScheduleBtn = document.getElementById("bulkScheduleBtn");
const bulkPublishStatus = document.getElementById("bulkPublishStatus");

const overlay = document.getElementById("previewOverlay");
const closePreview = document.getElementById("closePreview");
const previewCoverImg = document.getElementById("previewCoverImg");
const previewCoverFallback = document.getElementById("previewCoverFallback");
const previewSource = document.getElementById("previewSource");
const previewTitle = document.getElementById("previewTitle");
const previewAuthor = document.getElementById("previewAuthor");
const previewDescription = document.getElementById("previewDescription");
const previewFileState = document.getElementById("previewFileState");
const previewFileSize = document.getElementById("previewFileSize");
const previewFileSizeWarning = document.getElementById("previewFileSizeWarning");
const downloadLocalBtn = document.getElementById("downloadLocalBtn");
const downloadLocalHint = document.getElementById("downloadLocalHint");
const fileTypeChoice = document.getElementById("fileTypeChoice");
const fileTypePdf = document.getElementById("fileTypePdf");
const fileTypeEpub = document.getElementById("fileTypeEpub");
const previewDuplicateWarning = document.getElementById("previewDuplicateWarning");
const previewSavedNote = document.getElementById("previewSavedNote");
const previewScheduledNote = document.getElementById("previewScheduledNote");
const previewSourceRating = document.getElementById("previewSourceRating");
const saveBtn = document.getElementById("saveBtn");
const publishBtn = document.getElementById("publishBtn");
const publishCoverOnlyBtn = document.getElementById("publishCoverOnlyBtn");
const publishResult = document.getElementById("publishResult");
const scheduleDateTime = document.getElementById("scheduleDateTime");
const scheduleBtn = document.getElementById("scheduleBtn");

// Internet Archive source id in the backend registry (SOURCES) — collection browsing
// always uses it regardless of the visible "source" dropdown value, because any
// archive.org collection is built with the same source-3 data (buildBook/displayLine).
const ARCHIVE_SOURCE_ID = "3";

// Special value for the "All Sources" option — only meaningful in Search mode, since
// each real source's search already covers its whole catalog (no category filter),
// so searching "all sources" also inherently searches all of their categories.
const ALL_SOURCES_ID = "all";

let realSourceIds = []; // populated from /api/sources — the actual source ids (excludes "all")
let mode = "browse"; // "browse" | "search" | "collection"
let nextToken = null;
let allSourcesNextTokens = {}; // { [sourceId]: nextToken|null } — pagination state when "All Sources" is selected
let currentItem = null; // the raw currently selected item (sent as-is to preview/publish)
let currentItemSource = null; // the source id associated with currentItem when it was picked
let forceRepublish = false; // true if the user confirmed republishing an already-published book
let selectedFileType = null; // "pdf" | "epub" | null — the chosen format for publishing
let fileSizes = { pdf: null, epub: null }; // bytes, populated from the preview response
let downloadUrls = { pdf: null, epub: null }; // direct file links, for the "download locally" fallback
let currentSourceRating = null; // the book's real reader rating from its source (Open Library /
                                 // Google Books), when one exists — read-only, never set by the user
let isSaved = false; // whether currentItem is currently in the "saved for later" list
let currentCategory = null; // the category label the user was browsing under when this book
                             // was picked (Browse mode only) — tagged onto publish/save/schedule
                             // purely so the stats dashboard can show "most active by category"
let lastResults = []; // the most recently fetched (unfiltered) results — re-filtered/sorted
                       // in place when the rating filter changes, without a re-fetch
let ratingFilter = "all"; // "all" | "rated" | "top" | "unrated"

// A row's best-known rating: the rating you personally gave it if you published/rated it,
// otherwise the source's own reader rating (Open Library / Google Books) when available.
// Shared by sorting, the rating filter, and the row badge so all three agree on one number.
function effectiveRating(r) {
  return r.rating || r.source_rating || 0;
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
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "An unexpected error occurred");
  return data;
}

async function loadSources() {
  const sources = await jsonFetch("/api/sources");
  realSourceIds = sources.map((s) => s.id);
  const allOption = `<option value="${ALL_SOURCES_ID}">🌐 All Sources (search only)</option>`;
  const realOptions = sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  sourceSelect.innerHTML = allOption + realOptions;
  sourceSelect.value = realSourceIds[0]; // default to a real source so Browse mode works out of the box
  await loadCategories();
}

async function loadCategories() {
  const cats = await jsonFetch(`/api/categories?source=${sourceSelect.value}`);
  categorySelect.innerHTML = cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

function setMode(newMode) {
  mode = newMode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  sourceField.classList.toggle("hidden", mode === "collection" || mode === "saved" || mode === "scheduled");
  categoryField.classList.toggle("hidden", mode !== "browse");
  searchField.classList.toggle("hidden", mode !== "search");
  collectionField.classList.toggle("hidden", mode !== "collection");
  savedSearchInput.classList.toggle("hidden", mode !== "saved");
  ratingFilterSelect.parentElement.classList.toggle("hidden", mode === "scheduled");
  if (mode !== "saved") savedSearchInput.value = "";
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
  nextToken = null;
  lastResults = [];
  bulkSelected = new Set();
  bulkPublishBar.classList.add("hidden");
  bulkPublishStatus.classList.add("hidden");
  bulkPublishStatus.textContent = "";
  bulkScheduleDateTime.value = "";
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

  // Books you already published rank first (highest rating first, since that's a rating
  // you personally vetted). Among everything else, books with a real reader rating from
  // their source (Open Library / Google Books) rank next, highest first — so the better
  // options surface before you even open them. Everything with neither keeps its original
  // order at the bottom.
  const sorted = filtered
    .map((r, idx) => ({ r, idx }))
    .sort(
      (a, b) =>
        (b.r.rating || 0) - (a.r.rating || 0) ||
        (b.r.source_rating || 0) - (a.r.source_rating || 0) ||
        a.idx - b.idx
    )
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
  bulkSelectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
}

ratingFilterSelect.addEventListener("change", () => {
  ratingFilter = ratingFilterSelect.value;
  renderResults(lastResults); // re-apply without re-fetching — we already have the data
});
savedSearchInput.addEventListener("input", () => {
  renderResults(lastResults); // filters the already-loaded saved list, no re-fetch needed
});

async function runBrowse(useNext) {
  statusLine.textContent = "Loading…";
  try {
    const params = new URLSearchParams({ source: sourceSelect.value, category: categorySelect.value });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/browse?${params}`);
    const categoryLabel = categorySelect.options[categorySelect.selectedIndex]?.text || null;
    renderResults(data.results.map((r) => ({ ...r, source: sourceSelect.value, category: categoryLabel })));
    nextToken = data.next;
    nextPageBtn.classList.toggle("hidden", !nextToken);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

async function runSearch(useNext) {
  const q = searchInput.value.trim();
  if (!q) {
    statusLine.textContent = "Please enter search text.";
    return;
  }
  if (sourceSelect.value === ALL_SOURCES_ID) {
    return runSearchAllSources(q, useNext);
  }
  statusLine.textContent = "Searching…";
  try {
    const params = new URLSearchParams({ source: sourceSelect.value, q });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/search?${params}`);
    renderResults(data.results.map((r) => ({ ...r, source: sourceSelect.value })));
    nextToken = data.next;
    nextPageBtn.classList.toggle("hidden", !nextToken);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

// Searches every real source in parallel and merges the results. Each source keeps
// its own "next" pagination token (allSourcesNextTokens), since sources paginate
// independently — clicking "Next page" re-queries only the sources that still have
// more results and replaces the displayed list with that next batch, same as the
// single-source pagination behavior elsewhere in the app.
async function runSearchAllSources(q, useNext) {
  statusLine.textContent = "Searching all sources…";
  if (!useNext) allSourcesNextTokens = {};

  const idsToQuery = realSourceIds.filter((id) => !useNext || allSourcesNextTokens[id]);
  if (useNext && !idsToQuery.length) {
    nextPageBtn.classList.add("hidden");
    return;
  }

  const settled = await Promise.allSettled(
    idsToQuery.map(async (id) => {
      const params = new URLSearchParams({ source: id, q });
      const token = useNext ? allSourcesNextTokens[id] : null;
      if (token) params.set("next", token);
      const data = await jsonFetch(`/api/search?${params}`);
      return { id, data };
    })
  );

  let combined = [];
  let anyOk = false;
  settled.forEach((outcome, i) => {
    const id = idsToQuery[i];
    if (outcome.status === "fulfilled") {
      anyOk = true;
      const { data } = outcome.value;
      combined = combined.concat((data.results || []).map((r) => ({ ...r, source: id })));
      allSourcesNextTokens[id] = data.next || null;
    } else {
      allSourcesNextTokens[id] = null;
      console.warn(`Search failed for source ${id}:`, outcome.reason && outcome.reason.message);
    }
  });

  if (!anyOk) {
    statusLine.textContent = "⚠️ Search failed for all sources.";
    nextPageBtn.classList.add("hidden");
    return;
  }

  renderResults(combined);
  const hasMore = Object.values(allSourcesNextTokens).some((t) => !!t);
  nextPageBtn.classList.toggle("hidden", !hasMore);
}

async function runCollection(useNext) {
  const collection = collectionInput.value.trim();
  if (!collection) {
    statusLine.textContent = "Please enter a collection identifier.";
    return;
  }
  statusLine.textContent = "Loading…";
  try {
    const params = new URLSearchParams({ collection });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/collection?${params}`);
    renderResults(data.results.map((r) => ({ ...r, source: ARCHIVE_SOURCE_ID })));
    nextToken = data.next;
    nextPageBtn.classList.toggle("hidden", !nextToken);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

async function runSaved() {
  statusLine.textContent = "Loading saved books…";
  nextPageBtn.classList.add("hidden"); // saved list has no pagination
  try {
    const data = await jsonFetch("/api/saved");
    renderResults(data.results);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

function scheduledStatusLabel(status) {
  if (status === "pending") return "🕒 Pending";
  if (status === "published") return "✅ Published";
  if (status === "failed") return "⚠️ Failed";
  return status;
}

async function runScheduled() {
  statusLine.textContent = "Loading scheduled books…";
  nextPageBtn.classList.add("hidden");
  resultsList.innerHTML = "";
  try {
    const data = await jsonFetch("/api/scheduled");
    const records = data.records || [];
    statusLine.textContent = records.length
      ? `${records.length} scheduled book${records.length === 1 ? "" : "s"}`
      : "No scheduled books.";
    if (!records.length) return;

    records.forEach((r) => {
      const li = document.createElement("li");
      li.className = `scheduled-item status-${r.status}`;

      const title = document.createElement("div");
      title.className = "scheduled-item-title";
      title.textContent = r.rating ? `${"⭐".repeat(r.rating)} ${r.title}` : r.title;

      const meta = document.createElement("div");
      meta.className = "scheduled-item-meta";
      const when = new Date(r.scheduledFor).toLocaleString("en");
      meta.textContent = `${r.author}  —  ${r.source}  ·  scheduled for ${when}`;

      const statusEl = document.createElement("span");
      statusEl.className = `scheduled-item-status ${r.status}`;
      statusEl.textContent = scheduledStatusLabel(r.status);

      li.appendChild(title);
      li.appendChild(meta);
      li.appendChild(document.createElement("br"));
      li.appendChild(statusEl);

      if (r.message && r.status !== "pending") {
        const msg = document.createElement("div");
        msg.className = "scheduled-item-meta";
        msg.textContent = r.message;
        li.appendChild(msg);
      }

      const actions = document.createElement("div");
      actions.className = "scheduled-item-actions";
      const actionBtn = document.createElement("button");
      actionBtn.className = "btn-ghost";
      actionBtn.textContent = r.status === "pending" ? "✕ Cancel" : "🗑️ Clear";
      actionBtn.addEventListener("click", async () => {
        actionBtn.disabled = true;
        try {
          await jsonFetch("/api/scheduled-cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: r.id }),
          });
          runScheduled();
        } catch (e) {
          actionBtn.disabled = false;
          statusLine.textContent = `⚠️ ${e.message}`;
        }
      });
      actions.appendChild(actionBtn);
      li.appendChild(actions);

      resultsList.appendChild(li);
    });
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

// Schedules the book currently open in the preview to auto-publish at a future time
// instead of publishing it now — same rating requirement as immediate publishing, since
// the cron job that sends it later runs unattended.
async function scheduleCurrentBook() {
  if (!scheduleDateTime.value) {
    publishResult.textContent = "⚠️ Pick a date and time first.";
    return;
  }
  scheduleBtn.disabled = true;
  publishResult.textContent = "Scheduling…";
  try {
    const localDate = new Date(scheduleDateTime.value);
    await jsonFetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: currentItemSource,
        item: currentItem,
        fileType: selectedFileType,
        publishCoverOnlyIfNoFile: publishCoverOnlyBtn.classList.contains("hidden") ? false : true,
        category: currentCategory,
        scheduledFor: localDate.toISOString(),
      }),
    });
    publishResult.textContent = `✅ Scheduled for ${localDate.toLocaleString("en")}.`;
    previewScheduledNote.textContent = `🕒 Scheduled for ${localDate.toLocaleString("en")}.`;
    previewScheduledNote.classList.remove("hidden");
  } catch (e) {
    publishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    scheduleBtn.disabled = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Publishes every checked Saved Book one after another, with a short delay between each
// request so a big batch doesn't trip Telegram's flood-control limits. The backend derives
// each book's rating from its source automatically (or publishes with none), so nothing
// here needs to be skipped for lack of a rating.
const BULK_PUBLISH_DELAY_MS = 1800;

async function runBulkPublish() {
  const items = Array.from(bulkSelected);
  if (!items.length) return;

  bulkPublishBtn.disabled = true;
  bulkSelectAll.disabled = true;
  bulkPublishStatus.classList.remove("hidden");
  const lines = [];
  const renderStatus = () => {
    bulkPublishStatus.textContent = lines.join("\n");
  };

  let done = 0;
  for (const r of items) {
    done += 1;
    const label = r.line.replace(/^📌\s*/, "");
    lines.push(`⏳ (${done}/${items.length}) Publishing: ${label}`);
    renderStatus();
    try {
      const data = await jsonFetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: r.source,
          item: r.item,
          category: r.category || null,
          publishCoverOnlyIfNoFile: true,
          force: false,
        }),
      });
      lines[lines.length - 1] =
        data.status === "duplicate"
          ? `⚠️ (${done}/${items.length}) Already published, skipped: ${label}`
          : `✅ (${done}/${items.length}) Published: ${label}`;
    } catch (e) {
      lines[lines.length - 1] = `❌ (${done}/${items.length}) Failed — ${e.message}: ${label}`;
    }
    renderStatus();
    if (done < items.length) await sleep(BULK_PUBLISH_DELAY_MS);
  }

  bulkSelected = new Set();
  bulkPublishBtn.disabled = false;
  bulkSelectAll.disabled = false;
  bulkSelectAll.checked = false;
  await runSaved(); // refresh — published books drop out of the saved list automatically
}

// Schedules every checked Saved Book for the same target time, one request after another
// with the same flood-control delay as runBulkPublish. All sharing one scheduledFor is
// fine — the scheduled-publish cron already sleeps between each due record when it sends
// them (see scheduled-publish.js), so a same-time batch still goes out spread apart.
async function runBulkSchedule() {
  const items = Array.from(bulkSelected);
  if (!items.length) return;

  if (!bulkScheduleDateTime.value) {
    bulkPublishStatus.classList.remove("hidden");
    bulkPublishStatus.textContent = "⚠️ Pick a date and time first.";
    return;
  }
  const target = new Date(bulkScheduleDateTime.value);
  if (isNaN(target.getTime()) || target.getTime() <= Date.now()) {
    bulkPublishStatus.classList.remove("hidden");
    bulkPublishStatus.textContent = "⚠️ Please choose a time in the future.";
    return;
  }
  const scheduledForIso = target.toISOString();

  bulkPublishBtn.disabled = true;
  bulkScheduleBtn.disabled = true;
  bulkSelectAll.disabled = true;
  bulkPublishStatus.classList.remove("hidden");
  const lines = [];
  const renderStatus = () => {
    bulkPublishStatus.textContent = lines.join("\n");
  };

  let done = 0;
  for (const r of items) {
    done += 1;
    const label = r.line.replace(/^📌\s*/, "");
    lines.push(`⏳ (${done}/${items.length}) Scheduling: ${label}`);
    renderStatus();
    try {
      await jsonFetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: r.source,
          item: r.item,
          category: r.category || null,
          publishCoverOnlyIfNoFile: true,
          scheduledFor: scheduledForIso,
        }),
      });
      lines[lines.length - 1] = `✅ (${done}/${items.length}) Scheduled: ${label}`;
    } catch (e) {
      lines[lines.length - 1] = `❌ (${done}/${items.length}) Failed — ${e.message}: ${label}`;
    }
    renderStatus();
    if (done < items.length) await sleep(BULK_PUBLISH_DELAY_MS);
  }

  bulkSelected = new Set();
  bulkPublishBtn.disabled = false;
  bulkScheduleBtn.disabled = false;
  bulkSelectAll.disabled = false;
  bulkSelectAll.checked = false;
  bulkScheduleDateTime.value = "";
  renderResults(lastResults); // re-render so checkboxes clear (scheduled books stay in Saved)
}

function runCurrentQuery(useNext = false) {
  if (mode === "browse") runBrowse(useNext);
  else if (mode === "search") runSearch(useNext);
  else if (mode === "saved") runSaved();
  else if (mode === "scheduled") runScheduled();
  else runCollection(useNext);
}

async function openPreview(item, sourceId, category = null) {
  publishResult.textContent = "";
  currentItem = item;
  currentItemSource = sourceId;
  currentCategory = category || null;
  forceRepublish = false;
  selectedFileType = null;
  fileSizes = { pdf: null, epub: null };
  downloadUrls = { pdf: null, epub: null };
  currentSourceRating = null;
  renderSourceRating();
  overlay.classList.remove("hidden");
  previewTitle.textContent = "Loading…";
  previewAuthor.textContent = "";
  previewDescription.textContent = "";
  previewDescription.classList.add("hidden");
  previewFileState.textContent = "";
  previewFileSize.textContent = "";
  previewFileSize.classList.add("hidden");
  previewFileSizeWarning.textContent = "";
  previewFileSizeWarning.classList.add("hidden");
  downloadLocalBtn.classList.add("hidden");
  downloadLocalBtn.removeAttribute("href");
  fileTypeChoice.classList.add("hidden");
  fileTypePdf.checked = true;
  previewDuplicateWarning.classList.add("hidden");
  previewDuplicateWarning.textContent = "";
  isSaved = false;
  saveBtn.disabled = false;
  saveBtn.textContent = "💾 Save for Later";
  saveBtn.classList.remove("saved");
  previewSavedNote.classList.add("hidden");
  previewSavedNote.textContent = "";
  previewScheduledNote.classList.add("hidden");
  previewScheduledNote.textContent = "";
  scheduleDateTime.value = "";
  previewCoverImg.classList.add("hidden");
  previewCoverFallback.classList.add("hidden");
  publishBtn.classList.remove("hidden");
  publishBtn.textContent = "Publish to Channel";
  publishCoverOnlyBtn.classList.add("hidden");

  try {
    const book = await jsonFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: sourceId, item }),
    });
    previewSource.textContent = book.source;
    previewTitle.textContent = book.title;
    previewAuthor.textContent = book.author;

    if (book.description) {
      previewDescription.textContent = book.description;
      previewDescription.classList.remove("hidden");
    } else {
      previewDescription.textContent = "";
      previewDescription.classList.add("hidden");
    }

    if (book.cover_url) {
      previewCoverImg.src = book.cover_url;
      previewCoverImg.classList.remove("hidden");
    } else {
      previewCoverFallback.classList.remove("hidden");
    }

    if (book.already_published) {
      forceRepublish = true;
      const when = book.published_at ? new Date(book.published_at).toLocaleString("en") : "";
      previewDuplicateWarning.textContent = `⚠️ This book was already published${when ? " on " + when : ""}.`;
      previewDuplicateWarning.classList.remove("hidden");
    }

    if (book.already_saved) {
      isSaved = true;
      saveBtn.textContent = "🗑️ Remove from Saved";
      saveBtn.classList.add("saved");
      const when = book.saved_at ? new Date(book.saved_at).toLocaleString("en") : "";
      previewSavedNote.textContent = `📌 Saved for later${when ? " on " + when : ""}.`;
      previewSavedNote.classList.remove("hidden");
    }

    if (book.already_scheduled) {
      const when = book.scheduled_for ? new Date(book.scheduled_for).toLocaleString("en") : "";
      const extra = book.scheduled_count > 1 ? ` (${book.scheduled_count} pending schedules)` : "";
      previewScheduledNote.textContent = `🕒 Already scheduled${when ? " for " + when : ""}${extra}.`;
      previewScheduledNote.classList.remove("hidden");
    }

    currentSourceRating = typeof book.source_rating === "number" ? book.source_rating : null;
    renderSourceRating();

    const hasPdf = !!book.download_url_pdf;
    const hasEpub = !!book.download_url_epub;
    fileSizes = { pdf: book.file_size_pdf || null, epub: book.file_size_epub || null };
    downloadUrls = { pdf: book.download_url_pdf || null, epub: book.download_url_epub || null };

    if (hasPdf && hasEpub) {
      // available in both formats — show the file type and let the user choose
      previewFileState.textContent = "✓ Available in both PDF and EPUB";
      fileTypeChoice.classList.remove("hidden");
      fileTypePdf.checked = true;
      selectedFileType = "pdf";
      publishBtn.classList.remove("hidden");
      publishBtn.textContent = book.already_published ? "Publish Anyway" : "Publish to Channel";
      publishCoverOnlyBtn.classList.add("hidden");
    } else if (hasPdf || hasEpub) {
      // available in one format only — show it to the user, no choice needed
      selectedFileType = hasPdf ? "pdf" : "epub";
      previewFileState.textContent = `✓ Available in ${hasPdf ? "PDF" : "EPUB"} only`;
      fileTypeChoice.classList.add("hidden");
      publishBtn.classList.remove("hidden");
      publishBtn.textContent = book.already_published ? "Publish Anyway" : "Publish to Channel";
      publishCoverOnlyBtn.classList.add("hidden");
    } else {
      selectedFileType = null;
      previewFileState.textContent = "⚠️ No directly downloadable file is available for this book";
      fileTypeChoice.classList.add("hidden");
      publishBtn.classList.add("hidden");
      publishCoverOnlyBtn.classList.remove("hidden");
      publishCoverOnlyBtn.textContent = book.already_published ? "Publish Cover Anyway" : "Publish Cover Only";
    }
    updateFileSizeDisplay();
  } catch (e) {
    previewTitle.textContent = "Failed to load details";
    previewAuthor.textContent = e.message;
  }
}

async function publish(coverOnly) {
  publishResult.textContent = "Publishing…";
  publishBtn.disabled = true;
  publishCoverOnlyBtn.disabled = true;
  try {
    const data = await jsonFetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: currentItemSource,
        item: currentItem,
        publishCoverOnlyIfNoFile: coverOnly,
        force: forceRepublish,
        fileType: selectedFileType,
        category: currentCategory,
      }),
    });

    if (data.status === "duplicate") {
      // safety net: in case state changed between preview and publish (another tab, etc.)
      forceRepublish = true;
      publishResult.textContent = `${data.message}`;
      publishBtn.textContent = "Publish Anyway";
      publishCoverOnlyBtn.textContent = "Publish Cover Anyway";
      return;
    }

    publishResult.textContent = `✅ ${data.message}`;
    // The backend removes it from the saved list once published — mirror that here.
    if (isSaved) {
      isSaved = false;
      saveBtn.textContent = "💾 Save for Later";
      saveBtn.classList.remove("saved");
      previewSavedNote.classList.add("hidden");
    }
  } catch (e) {
    publishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    publishBtn.disabled = false;
    publishCoverOnlyBtn.disabled = false;
  }
}

async function toggleSave() {
  saveBtn.disabled = true;
  const endpoint = isSaved ? "/api/unsave" : "/api/save";
  try {
    await jsonFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: currentItemSource, item: currentItem, category: currentCategory }),
    });
    isSaved = !isSaved;
    if (isSaved) {
      saveBtn.textContent = "🗑️ Remove from Saved";
      saveBtn.classList.add("saved");
      previewSavedNote.textContent = "📌 Saved for later.";
      previewSavedNote.classList.remove("hidden");
    } else {
      saveBtn.textContent = "💾 Save for Later";
      saveBtn.classList.remove("saved");
      previewSavedNote.classList.add("hidden");
      // If we're viewing this book from the Saved Books list itself, it no longer belongs there.
      if (mode === "saved") runSaved();
    }
  } catch (e) {
    publishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

sourceSelect.addEventListener("change", async () => {
  if (sourceSelect.value === ALL_SOURCES_ID) {
    // Categories don't apply to "All Sources" — Browse mode needs one specific source,
    // so bump the user over to Search, where "All Sources" is fully supported.
    if (mode === "browse") {
      setMode("search");
    } else {
      resultsList.innerHTML = "";
      statusLine.textContent = "";
      nextPageBtn.classList.add("hidden");
    }
    return;
  }
  await loadCategories();
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
});

tabs.forEach((t) =>
  t.addEventListener("click", async () => {
    if (t.dataset.mode === "browse" && sourceSelect.value === ALL_SOURCES_ID) {
      // Browsing by category needs one specific source — fall back to the first real one.
      sourceSelect.value = realSourceIds[0];
      await loadCategories();
    }
    setMode(t.dataset.mode);
    if (t.dataset.mode === "saved") runSaved(); // no input to submit first, so load right away
    if (t.dataset.mode === "scheduled") runScheduled();
  })
);
categorySelect.addEventListener("change", () => runCurrentQuery(false));
searchBtn.addEventListener("click", () => runCurrentQuery(false));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runCurrentQuery(false);
});
collectionBtn.addEventListener("click", () => runCurrentQuery(false));
collectionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runCurrentQuery(false);
});
nextPageBtn.addEventListener("click", () => runCurrentQuery(true));
closePreview.addEventListener("click", () => overlay.classList.add("hidden"));
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.add("hidden");
});
publishBtn.addEventListener("click", () => publish(false));
publishCoverOnlyBtn.addEventListener("click", () => publish(true));
saveBtn.addEventListener("click", () => toggleSave());
fileTypePdf.addEventListener("change", () => {
  if (fileTypePdf.checked) selectedFileType = "pdf";
  updateFileSizeDisplay();
});
fileTypeEpub.addEventListener("change", () => {
  if (fileTypeEpub.checked) selectedFileType = "epub";
  updateFileSizeDisplay();
});
scheduleBtn.addEventListener("click", () => scheduleCurrentBook());

bulkSelectAll.addEventListener("change", () => {
  // Re-derive the currently visible rows the same way renderResults did, so "select all"
  // only ever touches what's on screen (respecting the active rating/text filter).
  let filtered = applyRatingFilter(lastResults);
  const q = savedSearchInput.value.trim().toLowerCase();
  if (q) filtered = filtered.filter((r) => r.line.toLowerCase().includes(q));

  if (bulkSelectAll.checked) filtered.forEach((r) => bulkSelected.add(r));
  else filtered.forEach((r) => bulkSelected.delete(r));
  renderResults(lastResults);
});
bulkPublishBtn.addEventListener("click", () => runBulkPublish());
bulkScheduleBtn.addEventListener("click", () => runBulkSchedule());

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  const originalText = exportBtn.textContent;
  exportBtn.textContent = "⬇️ Preparing…";
  try {
    const headers = {};
    if (sitePassword) headers["X-Site-Password"] = sitePassword;
    const r = await fetch("/api/export", { headers });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Failed to export backup");
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `book-index-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = originalText;
  }
});

importBtn.addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files && importFileInput.files[0];
  if (!file) return;

  importBtn.disabled = true;
  const originalText = importBtn.textContent;
  importBtn.textContent = "⬆️ Importing…";
  try {
    const text = await file.text();
    const result = await jsonFetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    const summarize = (label, r) =>
      `${label}: ${r.imported} imported, ${r.skipped} already had, ${r.invalid} invalid`;
    statusLine.textContent =
      `✅ Backup imported — ${summarize("Published", result.published)}; ` +
      `${summarize("Saved", result.saved)}; ${summarize("Scheduled", result.scheduled)}.`;
    if (mode === "saved") runSaved();
    else if (mode === "scheduled") runScheduled();
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = originalText;
    importFileInput.value = ""; // allow re-selecting the same file later
  }
});

function statsRow(label, value) {
  const row = document.createElement("div");
  row.className = "stats-row";
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "stats-value";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

function statsSectionTitle(text) {
  const h = document.createElement("p");
  h.className = "stats-section-title";
  h.textContent = text;
  return h;
}

function renderStats(data) {
  statsContent.innerHTML = "";

  statsContent.appendChild(statsRow("Total published", String(data.totalPublished)));
  statsContent.appendChild(statsRow("Saved for later", String(data.totalSaved)));
  statsContent.appendChild(
    statsRow("Average rating", data.averageRating ? `${data.averageRating.toFixed(1)} / 5 ⭐ (${data.totalRated} rated)` : "No ratings yet")
  );

  if (data.totalRated > 0) {
    statsContent.appendChild(statsSectionTitle("Rating breakdown"));
    const maxCount = Math.max(...Object.values(data.ratingBreakdown), 1);
    [5, 4, 3, 2, 1].forEach((star) => {
      const count = data.ratingBreakdown[star] || 0;
      const row = document.createElement("div");
      row.className = "stats-bar-row";

      const label = document.createElement("span");
      label.className = "stats-bar-label";
      label.textContent = `${"⭐".repeat(star)}`;

      const track = document.createElement("span");
      track.className = "stats-bar-track";
      const fill = document.createElement("span");
      fill.className = "stats-bar-fill";
      fill.style.width = `${(count / maxCount) * 100}%`;
      track.appendChild(fill);

      const countEl = document.createElement("span");
      countEl.className = "stats-bar-count";
      countEl.textContent = String(count);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(countEl);
      statsContent.appendChild(row);
    });
  }

  const sources = Object.entries(data.bySource || {});
  if (sources.length) {
    statsContent.appendChild(statsSectionTitle("By source"));
    sources
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => statsContent.appendChild(statsRow(name, String(count))));
  }

  statsContent.appendChild(statsSectionTitle("Recently published"));
  if (!data.recent.length) {
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.textContent = "Nothing published yet.";
    statsContent.appendChild(empty);
  } else {
    data.recent.forEach((b) => {
      const item = document.createElement("div");
      item.className = "stats-recent-item";

      const title = document.createElement("div");
      title.className = "stats-recent-title";
      title.textContent = b.rating ? `${"⭐".repeat(b.rating)} ${b.title}` : b.title;

      const meta = document.createElement("div");
      meta.className = "stats-recent-meta";
      const when = b.publishedAt ? new Date(b.publishedAt).toLocaleDateString("en") : "";
      meta.textContent = `${b.author}${when ? " · " + when : ""}`;

      item.appendChild(title);
      item.appendChild(meta);
      statsContent.appendChild(item);
    });
  }
}

async function openStats() {
  statsOverlay.classList.remove("hidden");
  statsContent.innerHTML = "<p class=\"stats-empty\">Loading…</p>";
  try {
    const data = await jsonFetch("/api/stats");
    renderStats(data);
  } catch (e) {
    statsContent.innerHTML = "";
    const err = document.createElement("p");
    err.className = "stats-empty";
    err.textContent = `⚠️ ${e.message}`;
    statsContent.appendChild(err);
  }
}

statsBtn.addEventListener("click", () => openStats());
closeStats.addEventListener("click", () => statsOverlay.classList.add("hidden"));
statsOverlay.addEventListener("click", (e) => {
  if (e.target === statsOverlay) statsOverlay.classList.add("hidden");
});

// Shows each of the 6 sources' live status (from /api/health) using the same row layout
// as the Stats panel, so a source going down (Gutendex's Cloudflare 403s especially) is
// easy to spot without digging through function logs.
function renderHealth(data) {
  healthContent.innerHTML = "";
  healthContent.appendChild(
    statsRow("Sources up", `${data.healthy} / ${data.total}`)
  );
  healthContent.appendChild(
    statsRow("Checked at", new Date(data.checkedAt).toLocaleString("en"))
  );
  healthContent.appendChild(statsSectionTitle("Sources"));
  data.sources.forEach((s) => {
    const row = document.createElement("div");
    row.className = "stats-row";
    const l = document.createElement("span");
    l.textContent = `${s.ok ? "✅" : "❌"} ${s.name}`;
    const v = document.createElement("span");
    v.className = "stats-value";
    v.textContent = s.ok ? `${s.ms}ms` : s.error || `status ${s.status}`;
    row.appendChild(l);
    row.appendChild(v);
    healthContent.appendChild(row);
  });
}

async function openHealth() {
  healthOverlay.classList.remove("hidden");
  healthContent.innerHTML = "<p class=\"stats-empty\">Checking sources…</p>";
  try {
    const data = await jsonFetch("/api/health");
    renderHealth(data);
  } catch (e) {
    healthContent.innerHTML = "";
    const err = document.createElement("p");
    err.className = "stats-empty";
    err.textContent = `⚠️ ${e.message}`;
    healthContent.appendChild(err);
  }
}

healthBtn.addEventListener("click", () => openHealth());
closeHealth.addEventListener("click", () => healthOverlay.classList.add("hidden"));
healthOverlay.addEventListener("click", (e) => {
  if (e.target === healthOverlay) healthOverlay.classList.add("hidden");
});

async function unlockApp() {
  loginOverlay.classList.add("hidden");
  mainCatalog.classList.remove("hidden");
  await loadSources();
  await runBrowse(false);
}

async function attemptLogin(password) {
  loginBtn.disabled = true;
  loginError.classList.add("hidden");
  sitePassword = password;
  try {
    // /api/sources is the lightest authenticated endpoint — used purely to verify the password.
    await jsonFetch("/api/sources");
    localStorage.setItem(SITE_PASSWORD_STORAGE_KEY, password);
    await unlockApp();
  } catch (e) {
    sitePassword = null;
    localStorage.removeItem(SITE_PASSWORD_STORAGE_KEY);
    loginError.textContent = `⚠️ ${e.message}`;
    loginError.classList.remove("hidden");
  } finally {
    loginBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", () => {
  const value = loginPassword.value.trim();
  if (value) attemptLogin(value);
});
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

(async function init() {
  const stored = localStorage.getItem(SITE_PASSWORD_STORAGE_KEY);
  if (stored) {
    await attemptLogin(stored); // silent re-check; falls back to the login screen if it's no longer valid
  }
})();

