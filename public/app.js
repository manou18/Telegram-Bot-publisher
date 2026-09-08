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
const nextPageBtn = document.getElementById("nextPageBtn");
const tabs = document.querySelectorAll(".tab");

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
const fileTypeChoice = document.getElementById("fileTypeChoice");
const fileTypePdf = document.getElementById("fileTypePdf");
const fileTypeEpub = document.getElementById("fileTypeEpub");
const previewDuplicateWarning = document.getElementById("previewDuplicateWarning");
const publishBtn = document.getElementById("publishBtn");
const publishCoverOnlyBtn = document.getElementById("publishCoverOnlyBtn");
const publishResult = document.getElementById("publishResult");

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
    return;
  }
  const label = selectedFileType ? selectedFileType.toUpperCase() : "";
  previewFileSize.textContent = `📦 Size: ${formatted}${fileTypeChoice.classList.contains("hidden") ? "" : ` (${label})`}`;
  previewFileSize.classList.remove("hidden");
}

async function jsonFetch(url, opts) {
  const r = await fetch(url, opts);
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
  sourceField.classList.toggle("hidden", mode === "collection");
  categoryField.classList.toggle("hidden", mode !== "browse");
  searchField.classList.toggle("hidden", mode !== "search");
  collectionField.classList.toggle("hidden", mode !== "collection");
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
  nextToken = null;
}

function renderResults(results) {
  resultsList.innerHTML = "";
  if (!results.length) {
    statusLine.textContent = "No results.";
    return;
  }
  statusLine.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`;
  results.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r.line;
    li.addEventListener("click", () => openPreview(r.item, r.source));
    resultsList.appendChild(li);
  });
}

async function runBrowse(useNext) {
  statusLine.textContent = "Loading…";
  try {
    const params = new URLSearchParams({ source: sourceSelect.value, category: categorySelect.value });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/browse?${params}`);
    renderResults(data.results.map((r) => ({ ...r, source: sourceSelect.value })));
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

function runCurrentQuery(useNext = false) {
  if (mode === "browse") runBrowse(useNext);
  else if (mode === "search") runSearch(useNext);
  else runCollection(useNext);
}

async function openPreview(item, sourceId) {
  publishResult.textContent = "";
  currentItem = item;
  currentItemSource = sourceId;
  forceRepublish = false;
  selectedFileType = null;
  fileSizes = { pdf: null, epub: null };
  overlay.classList.remove("hidden");
  previewTitle.textContent = "Loading…";
  previewAuthor.textContent = "";
  previewDescription.textContent = "";
  previewDescription.classList.add("hidden");
  previewFileState.textContent = "";
  previewFileSize.textContent = "";
  previewFileSize.classList.add("hidden");
  fileTypeChoice.classList.add("hidden");
  fileTypePdf.checked = true;
  previewDuplicateWarning.classList.add("hidden");
  previewDuplicateWarning.textContent = "";
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

    const hasPdf = !!book.download_url_pdf;
    const hasEpub = !!book.download_url_epub;
    fileSizes = { pdf: book.file_size_pdf || null, epub: book.file_size_epub || null };

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
  } catch (e) {
    publishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    publishBtn.disabled = false;
    publishCoverOnlyBtn.disabled = false;
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
fileTypePdf.addEventListener("change", () => {
  if (fileTypePdf.checked) selectedFileType = "pdf";
  updateFileSizeDisplay();
});
fileTypeEpub.addEventListener("change", () => {
  if (fileTypeEpub.checked) selectedFileType = "epub";
  updateFileSizeDisplay();
});

(async function init() {
  await loadSources();
  await runBrowse(false);
})();

