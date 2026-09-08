const sourceSelect = document.getElementById("sourceSelect");
const categorySelect = document.getElementById("categorySelect");
const categoryField = document.getElementById("categoryField");
const searchField = document.getElementById("searchField");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
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
const previewFileState = document.getElementById("previewFileState");
const publishBtn = document.getElementById("publishBtn");
const publishCoverOnlyBtn = document.getElementById("publishCoverOnlyBtn");
const publishResult = document.getElementById("publishResult");

let mode = "browse"; // "browse" | "search"
let nextToken = null;
let currentItem = null; // العنصر الخام المختار حاليًا (يُرسل كما هو لـ preview/publish)

async function jsonFetch(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "حدث خطأ غير متوقع");
  return data;
}

async function loadSources() {
  const sources = await jsonFetch("/api/sources");
  sourceSelect.innerHTML = sources.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  await loadCategories();
}

async function loadCategories() {
  const cats = await jsonFetch(`/api/categories?source=${sourceSelect.value}`);
  categorySelect.innerHTML = cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

function setMode(newMode) {
  mode = newMode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  categoryField.classList.toggle("hidden", mode !== "browse");
  searchField.classList.toggle("hidden", mode !== "search");
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
  nextToken = null;
}

function renderResults(results) {
  resultsList.innerHTML = "";
  if (!results.length) {
    statusLine.textContent = "لا توجد نتائج.";
    return;
  }
  statusLine.textContent = `${results.length} نتيجة`;
  results.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r.line;
    li.addEventListener("click", () => openPreview(r.item));
    resultsList.appendChild(li);
  });
}

async function runBrowse(useNext) {
  statusLine.textContent = "جارٍ التحميل…";
  try {
    const params = new URLSearchParams({ source: sourceSelect.value, category: categorySelect.value });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/browse?${params}`);
    renderResults(data.results);
    nextToken = data.next;
    nextPageBtn.classList.toggle("hidden", !nextToken);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

async function runSearch(useNext) {
  const q = searchInput.value.trim();
  if (!q) {
    statusLine.textContent = "الرجاء إدخال نص للبحث.";
    return;
  }
  statusLine.textContent = "جارٍ البحث…";
  try {
    const params = new URLSearchParams({ source: sourceSelect.value, q });
    if (useNext && nextToken) params.set("next", nextToken);
    const data = await jsonFetch(`/api/search?${params}`);
    renderResults(data.results);
    nextToken = data.next;
    nextPageBtn.classList.toggle("hidden", !nextToken);
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

function runCurrentQuery(useNext = false) {
  if (mode === "browse") runBrowse(useNext);
  else runSearch(useNext);
}

async function openPreview(item) {
  publishResult.textContent = "";
  currentItem = item;
  overlay.classList.remove("hidden");
  previewTitle.textContent = "جارٍ التحميل…";
  previewAuthor.textContent = "";
  previewFileState.textContent = "";
  previewCoverImg.classList.add("hidden");
  previewCoverFallback.classList.add("hidden");
  publishBtn.classList.remove("hidden");
  publishCoverOnlyBtn.classList.add("hidden");

  try {
    const book = await jsonFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: sourceSelect.value, item }),
    });
    previewSource.textContent = book.source;
    previewTitle.textContent = book.title;
    previewAuthor.textContent = book.author;

    if (book.cover_url) {
      previewCoverImg.src = book.cover_url;
      previewCoverImg.classList.remove("hidden");
    } else {
      previewCoverFallback.classList.remove("hidden");
    }

    if (book.download_url) {
      previewFileState.textContent = "✓ يوجد ملف قابل للتحميل";
      publishBtn.classList.remove("hidden");
      publishCoverOnlyBtn.classList.add("hidden");
    } else {
      previewFileState.textContent = "⚠️ لا يوجد ملف قابل للتحميل مباشرة لهذا الكتاب";
      publishBtn.classList.add("hidden");
      publishCoverOnlyBtn.classList.remove("hidden");
    }
  } catch (e) {
    previewTitle.textContent = "تعذّر تحميل التفاصيل";
    previewAuthor.textContent = e.message;
  }
}

async function publish(coverOnly) {
  publishResult.textContent = "جارٍ النشر…";
  publishBtn.disabled = true;
  publishCoverOnlyBtn.disabled = true;
  try {
    const data = await jsonFetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: sourceSelect.value,
        item: currentItem,
        publishCoverOnlyIfNoFile: coverOnly,
      }),
    });
    publishResult.textContent = `✅ ${data.message}`;
  } catch (e) {
    publishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    publishBtn.disabled = false;
    publishCoverOnlyBtn.disabled = false;
  }
}

sourceSelect.addEventListener("change", async () => {
  await loadCategories();
  resultsList.innerHTML = "";
  statusLine.textContent = "";
  nextPageBtn.classList.add("hidden");
});

tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
categorySelect.addEventListener("change", () => runCurrentQuery(false));
searchBtn.addEventListener("click", () => runCurrentQuery(false));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runCurrentQuery(false);
});
nextPageBtn.addEventListener("click", () => runCurrentQuery(true));
closePreview.addEventListener("click", () => overlay.classList.add("hidden"));
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.add("hidden");
});
publishBtn.addEventListener("click", () => publish(false));
publishCoverOnlyBtn.addEventListener("click", () => publish(true));

(async function init() {
  await loadSources();
  await runBrowse(false);
})();
