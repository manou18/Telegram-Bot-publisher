// === 05: Check Copyright tab + the standalone Cover Mockup tool ===

const VERDICT_LABELS = {
  likely_public_domain: "✅ Likely public domain / openly licensed",
  likely_copyrighted: "⚠️ Likely still copyrighted",
  no_match: "❔ No match found in any catalog",
  uncertain: "❔ Uncertain — mixed signals",
};

function renderCopyrightResult(data) {
  copyrightResult.innerHTML = "";

  const verdict = document.createElement("p");
  verdict.className = `copyright-verdict ${data.verdict}`;
  verdict.textContent = VERDICT_LABELS[data.verdict] || data.verdict;
  copyrightResult.appendChild(verdict);

  const summary = document.createElement("p");
  summary.textContent = data.summary;
  copyrightResult.appendChild(summary);

  const list = document.createElement("ul");
  list.className = "copyright-signals";
  (data.signals || []).forEach((s) => {
    const li = document.createElement("li");
    li.textContent = `${s.source}: ${s.note}`;
    list.appendChild(li);
  });
  copyrightResult.appendChild(list);

  const disclaimer = document.createElement("p");
  disclaimer.className = "copyright-disclaimer";
  disclaimer.textContent = data.disclaimer;
  copyrightResult.appendChild(disclaimer);

  copyrightResult.classList.remove("hidden");
}

let copyrightCoverValue = null; // data: URI or URL for the "check by cover" flow
const MAX_COVER_UPLOAD_MB = 1.5; // shared cap for cover uploads (copyright-by-cover, mockup tool)

function resetCopyrightForm() {
  copyrightTitleInput.value = "";
  copyrightAuthorInput.value = "";
  copyrightResult.classList.add("hidden");
  copyrightResult.innerHTML = "";
  checkCopyrightBtn.disabled = false;
  checkCopyrightBtn.textContent = "🔍 Check Copyright Status";
  copyrightCoverValue = null;
  copyrightCoverFile.value = "";
  copyrightCoverUrlInput.value = "";
  copyrightCoverPreview.classList.add("hidden");
  copyrightCoverPreview.removeAttribute("src");
  copyrightRemoveCoverBtn.classList.add("hidden");
  checkCopyrightByCoverBtn.disabled = true;
  checkCopyrightByCoverBtn.textContent = "✨ Read Cover & Check Copyright";
}

async function runCopyrightCheck(title, author) {
  if (!title) {
    copyrightResult.innerHTML = "";
    copyrightResult.textContent = "⚠️ Enter a title first.";
    copyrightResult.classList.remove("hidden");
    return;
  }
  copyrightResult.innerHTML = "";
  copyrightResult.textContent = "Checking Project Gutenberg, Google Books, and Open Library…";
  copyrightResult.classList.remove("hidden");
  try {
    const data = await jsonFetch("/api/copyright-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, author: author || "" }),
    });
    renderCopyrightResult(data);
  } catch (e) {
    copyrightResult.innerHTML = "";
    copyrightResult.textContent = `⚠️ ${e.message}`;
  }
}

checkCopyrightBtn.addEventListener("click", async () => {
  checkCopyrightBtn.disabled = true;
  checkCopyrightBtn.textContent = "Checking…";
  await runCopyrightCheck(copyrightTitleInput.value.trim(), copyrightAuthorInput.value.trim());
  checkCopyrightBtn.disabled = false;
  checkCopyrightBtn.textContent = "🔍 Check Copyright Status";
});

copyrightCoverFile.addEventListener("change", () => {
  const file = copyrightCoverFile.files && copyrightCoverFile.files[0];
  if (!file) return;
  if (file.size > MAX_COVER_UPLOAD_MB * 1024 * 1024) {
    copyrightResult.textContent = `⚠️ Cover image is too large (max ${MAX_COVER_UPLOAD_MB}MB) — pick a smaller file or paste a URL instead.`;
    copyrightResult.classList.remove("hidden");
    copyrightCoverFile.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    copyrightCoverValue = reader.result;
    copyrightCoverUrlInput.value = "";
    copyrightCoverPreview.src = copyrightCoverValue;
    copyrightCoverPreview.classList.remove("hidden");
    copyrightRemoveCoverBtn.classList.remove("hidden");
    checkCopyrightByCoverBtn.disabled = false;
  };
  reader.readAsDataURL(file);
});

copyrightUseCoverUrlBtn.addEventListener("click", () => {
  const url = copyrightCoverUrlInput.value.trim();
  if (!url) return;
  copyrightCoverValue = url;
  copyrightCoverFile.value = "";
  copyrightCoverPreview.src = url;
  copyrightCoverPreview.classList.remove("hidden");
  copyrightRemoveCoverBtn.classList.remove("hidden");
  checkCopyrightByCoverBtn.disabled = false;
});

copyrightRemoveCoverBtn.addEventListener("click", () => {
  copyrightCoverValue = null;
  copyrightCoverFile.value = "";
  copyrightCoverUrlInput.value = "";
  copyrightCoverPreview.classList.add("hidden");
  copyrightCoverPreview.removeAttribute("src");
  copyrightRemoveCoverBtn.classList.add("hidden");
  checkCopyrightByCoverBtn.disabled = true;
});

checkCopyrightByCoverBtn.addEventListener("click", async () => {
  if (!copyrightCoverValue) return;
  checkCopyrightByCoverBtn.disabled = true;
  checkCopyrightByCoverBtn.textContent = "Reading cover…";
  copyrightResult.innerHTML = "";
  copyrightResult.textContent = "Reading the cover with Gemini…";
  copyrightResult.classList.remove("hidden");
  try {
    const extracted = await jsonFetch("/api/extract-book-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover_url: copyrightCoverValue, has_cover: true }),
    });
    copyrightTitleInput.value = extracted.title || "";
    copyrightAuthorInput.value = extracted.author || "";
    if (!extracted.title) {
      copyrightResult.textContent = "⚠️ Couldn't read a title off that cover — try a clearer image or enter it manually.";
      return;
    }
    checkCopyrightByCoverBtn.textContent = "Checking…";
    await runCopyrightCheck(extracted.title, extracted.author || "");
  } catch (e) {
    copyrightResult.innerHTML = "";
    copyrightResult.textContent = `⚠️ ${e.message}`;
  } finally {
    checkCopyrightByCoverBtn.disabled = false;
    checkCopyrightByCoverBtn.textContent = "✨ Read Cover & Check Copyright";
  }
});

extractInfoBtn.addEventListener("click", async () => {
  if (!manualCoverValue && !manualFileValue) {
    extractInfoResult.innerHTML = "";
    extractInfoResult.textContent = "⚠️ Add a cover image or a book file first.";
    extractInfoResult.classList.remove("hidden");
    return;
  }
  const fileType = manualFileValue ? (manualFileTypeEpub.checked ? "epub" : "pdf") : null;

  extractInfoBtn.disabled = true;
  extractInfoBtn.textContent = "Reading with AI…";
  extractInfoResult.innerHTML = "";
  extractInfoResult.textContent = "Reading the cover/file with Gemini — this can take a little while for larger PDFs…";
  extractInfoResult.classList.remove("hidden");
  try {
    const data = await jsonFetch("/api/extract-book-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cover_url: manualCoverValue,
        file_url: manualFileValue,
        file_type: fileType,
        has_cover: !!manualCoverValue,
      }),
    });
    if (data.title) manualTitleInput.value = data.title;
    if (data.author) manualAuthorInput.value = data.author;
    if (data.description) manualDescriptionInput.value = data.description;

    const filled = [
      data.title ? "title" : null,
      data.author ? "author" : null,
      data.description ? "description" : null,
    ].filter(Boolean);
    let message = filled.length
      ? `✅ Filled in: ${filled.join(", ")}. Review before publishing.`
      : "⚠️ Gemini couldn't confidently determine any of the fields from what was provided.";
    if (data.warnings && data.warnings.length) {
      message += ` (${data.warnings.join(" ")})`;
    }
    extractInfoResult.textContent = message;
  } catch (e) {
    extractInfoResult.textContent = `⚠️ ${e.message}`;
  } finally {
    extractInfoBtn.disabled = false;
    extractInfoBtn.textContent = "✨ Extract Title/Author/Description with AI";
  }
});

const MAX_MANUAL_COVER_MB = 1.5;
const MAX_MANUAL_FILE_MB = 3.5;

manualCoverFile.addEventListener("change", () => {
  const file = manualCoverFile.files && manualCoverFile.files[0];
  if (!file) return;
  if (file.size > MAX_MANUAL_COVER_MB * 1024 * 1024) {
    manualPublishResult.textContent = `⚠️ Cover image is too large (max ${MAX_MANUAL_COVER_MB}MB) — pick a smaller file or paste a URL instead.`;
    manualCoverFile.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    manualCoverValue = reader.result;
    manualCoverUrlInput.value = "";
    manualCoverPreview.src = manualCoverValue;
    manualCoverPreview.classList.remove("hidden");
    manualRemoveCoverBtn.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

manualUseCoverUrlBtn.addEventListener("click", () => {
  const url = manualCoverUrlInput.value.trim();
  if (!url) return;
  manualCoverValue = url;
  manualCoverFile.value = "";
  manualCoverPreview.src = url;
  manualCoverPreview.classList.remove("hidden");
  manualRemoveCoverBtn.classList.remove("hidden");
});

manualRemoveCoverBtn.addEventListener("click", () => {
  manualCoverValue = null;
  manualCoverFile.value = "";
  manualCoverUrlInput.value = "";
  manualCoverPreview.classList.add("hidden");
  manualCoverPreview.removeAttribute("src");
  manualRemoveCoverBtn.classList.add("hidden");
});

function resetMockupOutput() {
  mockupResult.classList.add("hidden");
  mockupResult.textContent = "";
  mockupOutputWrap.classList.add("hidden");
  mockupResultImg.classList.add("hidden");
  mockupResultImg.removeAttribute("src");
  mockupDownloadBtn.classList.add("hidden");
  mockupDownloadBtn.removeAttribute("href");
}

// Full reset of the standalone mockup tool (covers + scene output) — used when switching
// into the Mockup tab, so leftover covers from a previous visit don't carry over.
function resetMockupTool() {
  mockupCovers = [];
  mockupCoverUrlInput.value = "";
  renderMockupCoversList();
  resetMockupOutput();
}

// Re-renders the thumbnail strip from mockupCovers, wires each thumbnail's remove
// button, and keeps the Generate button / upload controls in sync with how many covers
// are currently added (disabled at MOCKUP_MAX_COVERS since a 5th book wouldn't fit well).
function renderMockupCoversList() {
  mockupCoversList.innerHTML = mockupCovers
    .map(
      (src, i) =>
        `<div class="mockup-cover-thumb-item"><img src="${src}" alt="Cover ${i + 1}"/><button type="button" class="mockup-cover-remove" data-index="${i}">✕</button></div>`
    )
    .join("");
  mockupGenerateBtn.disabled = mockupCovers.length === 0;
  const atCap = mockupCovers.length >= MOCKUP_MAX_COVERS;
  mockupCoverFile.disabled = atCap;
  mockupUseCoverUrlBtn.disabled = atCap;
}

mockupCoversList.addEventListener("click", (e) => {
  const btn = e.target.closest(".mockup-cover-remove");
  if (!btn) return;
  mockupCovers.splice(Number(btn.dataset.index), 1);
  renderMockupCoversList();
  resetMockupOutput();
});

mockupCoverFile.addEventListener("change", () => {
  const files = Array.from(mockupCoverFile.files || []);
  if (!files.length) return;
  const room = MOCKUP_MAX_COVERS - mockupCovers.length;
  const accepted = files.slice(0, room);
  if (files.length > room) {
    mockupResult.textContent = `⚠️ Only ${room} more cover(s) fit (max ${MOCKUP_MAX_COVERS} total) — the rest were skipped.`;
    mockupResult.classList.remove("hidden");
  }
  const oversized = accepted.filter((f) => f.size > MAX_COVER_UPLOAD_MB * 1024 * 1024);
  const usable = accepted.filter((f) => f.size <= MAX_COVER_UPLOAD_MB * 1024 * 1024);
  if (oversized.length) {
    mockupResult.textContent = `⚠️ ${oversized.length} image(s) were too large (max ${MAX_COVER_UPLOAD_MB}MB each) and were skipped.`;
    mockupResult.classList.remove("hidden");
  }
  Promise.all(
    usable.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    )
  ).then((dataUris) => {
    mockupCovers.push(...dataUris);
    renderMockupCoversList();
    resetMockupOutput();
  });
  mockupCoverFile.value = "";
});

mockupUseCoverUrlBtn.addEventListener("click", () => {
  const url = mockupCoverUrlInput.value.trim();
  if (!url) return;
  if (mockupCovers.length >= MOCKUP_MAX_COVERS) return;
  mockupCovers.push(url);
  mockupCoverUrlInput.value = "";
  renderMockupCoversList();
  resetMockupOutput();
});

mockupGenerateBtn.addEventListener("click", async () => {
  if (!mockupCovers.length) return;
  mockupGenerateBtn.disabled = true;
  mockupGenerateBtn.textContent = "Generating…";
  resetMockupOutput();
  mockupResult.textContent = mockupCovers.length > 1 ? "Building the collection mockup…" : "Building the mockup…";
  mockupResult.classList.remove("hidden");
  try {
    const data = await jsonFetch("/api/mockup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cover_urls: mockupCovers, scene: mockupSceneSelect.value }),
    });
    mockupResult.classList.add("hidden");
    mockupOutputWrap.classList.remove("hidden");
    mockupResultImg.src = data.mockup_url;
    mockupResultImg.classList.remove("hidden");
    mockupDownloadBtn.href = data.mockup_url;
    mockupDownloadBtn.classList.remove("hidden");
  } catch (e) {
    mockupResult.textContent = `⚠️ ${e.message}`;
    mockupResult.classList.remove("hidden");
  } finally {
    mockupGenerateBtn.disabled = mockupCovers.length === 0;
    mockupGenerateBtn.textContent = "🪄 Generate Mockup";
  }
});

manualBookFile.addEventListener("change", () => {
  const file = manualBookFile.files && manualBookFile.files[0];
  if (!file) return;
  if (file.size > MAX_MANUAL_FILE_MB * 1024 * 1024) {
    manualPublishResult.textContent = `⚠️ File is too large (max ${MAX_MANUAL_FILE_MB}MB for direct upload) — paste a direct file URL instead.`;
    manualBookFile.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    manualFileValue = reader.result;
    manualFileUrlInput.value = "";
    manualBookFileName.textContent = `📄 ${file.name}`;
    manualBookFileName.classList.remove("hidden");
    manualRemoveFileBtn.classList.remove("hidden");
    manualFileTypeChoice.classList.remove("hidden");
    // Pre-select the format from the file extension, still overridable by the user.
    if (/\.epub$/i.test(file.name)) {
      manualFileTypeEpub.checked = true;
    } else {
      manualFileTypePdf.checked = true;
    }
    updateManualPublishButtons();
  };
  reader.readAsDataURL(file);
});

manualUseFileUrlBtn.addEventListener("click", () => {
  const url = manualFileUrlInput.value.trim();
  if (!url) return;
  manualFileValue = url;
  manualBookFile.value = "";
  manualBookFileName.textContent = `🔗 ${url}`;
  manualBookFileName.classList.remove("hidden");
  manualRemoveFileBtn.classList.remove("hidden");
  manualFileTypeChoice.classList.remove("hidden");
  if (/\.epub(\?|$)/i.test(url)) {
    manualFileTypeEpub.checked = true;
  } else {
    manualFileTypePdf.checked = true;
  }
  updateManualPublishButtons();
});

manualRemoveFileBtn.addEventListener("click", () => {
  manualFileValue = null;
  manualBookFile.value = "";
  manualFileUrlInput.value = "";
  manualBookFileName.classList.add("hidden");
  manualBookFileName.textContent = "";
  manualRemoveFileBtn.classList.add("hidden");
  manualFileTypeChoice.classList.add("hidden");
  updateManualPublishButtons();
});

