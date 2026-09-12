// === 06: Add Manually tab (publishManual, validation) + shared save/toggle + custom-cover preview helpers ===

async function publishManual(coverOnly) {
  const title = manualTitleInput.value.trim();
  if (!title) {
    manualPublishResult.textContent = "⚠️ Title is required.";
    return;
  }
  if (!manualCoverValue && !manualFileValue) {
    manualPublishResult.textContent = "⚠️ Add at least a cover or a book file.";
    return;
  }
  manualPublishResult.textContent = "Publishing…";
  manualPublishBtn.disabled = true;
  manualPublishCoverOnlyBtn.disabled = true;
  try {
    const data = await jsonFetch("/api/publish-manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author: manualAuthorInput.value.trim(),
        description: manualDescriptionInput.value.trim(),
        cover_url: manualCoverValue,
        download_url: manualFileValue,
        fileType: manualFileTypeEpub.checked ? "epub" : "pdf",
        publishCoverOnlyIfNoFile: coverOnly,
        force: manualForceRepublish,
        channels: getSelectedChannelIds(),
      }),
    });

    if (data.status === "duplicate") {
      manualForceRepublish = true;
      manualPublishResult.textContent = data.message;
      manualPublishBtn.textContent = "Publish Anyway";
      manualPublishCoverOnlyBtn.textContent = "Publish Cover Anyway";
      return;
    }

    manualPublishResult.textContent = `✅ ${data.message}`;
  } catch (e) {
    manualPublishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    manualPublishBtn.disabled = false;
    manualPublishCoverOnlyBtn.disabled = false;
  }
}

function validateManualBeforeReview() {
  if (!manualTitleInput.value.trim()) {
    manualPublishResult.textContent = "⚠️ Title is required.";
    return false;
  }
  if (!manualCoverValue && !manualFileValue) {
    manualPublishResult.textContent = "⚠️ Add at least a cover or a book file.";
    return false;
  }
  return true;
}

manualPublishBtn.addEventListener("click", () => {
  if (validateManualBeforeReview()) openPublishReviewForManual(false);
});
manualPublishCoverOnlyBtn.addEventListener("click", () => {
  if (validateManualBeforeReview()) openPublishReviewForManual(true);
});

manualSaveBtn.addEventListener("click", async () => {
  const title = manualTitleInput.value.trim();
  if (!title) {
    manualPublishResult.textContent = "⚠️ Add a title first.";
    return;
  }
  manualSaveBtn.disabled = true;
  const endpoint = manualIsSaved ? "/api/unsave" : "/api/save";
  const item = { title, author: manualAuthorInput.value.trim() };
  const body = { source: "manual", item };
  if (!manualIsSaved) {
    // Same "custom cover/description" storage this app already uses for saved search
    // results — here the manual entry's own fields ARE the custom cover/description,
    // since there's no separate source to fall back to.
    body.customDescription = manualDescriptionInput.value.trim();
    body.customCoverUrl = manualCoverValue || (manualCoverPreview.classList.contains("hidden") ? null : manualCoverPreview.src);
  }
  try {
    await jsonFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    manualIsSaved = !manualIsSaved;
    if (manualIsSaved) {
      manualSaveBtn.textContent = "🗑️ Remove from Saved";
      manualSaveBtn.classList.add("saved");
      manualPublishResult.textContent = "📌 Saved for later.";
    } else {
      manualSaveBtn.textContent = "💾 Save for Later";
      manualSaveBtn.classList.remove("saved");
      manualPublishResult.textContent = "";
    }
  } catch (e) {
    manualPublishResult.textContent = `⚠️ ${e.message}`;
  } finally {
    manualSaveBtn.disabled = false;
  }
});

async function toggleSave() {
  saveBtn.disabled = true;
  const endpoint = isSaved ? "/api/unsave" : "/api/save";
  const body = { source: currentItemSource, item: currentItem, category: currentCategory };
  if (!isSaved) {
    // Only relevant when saving (not unsaving) — carries forward whatever's currently in
    // the description field (original, hand-edited, or AI-rewritten) so it isn't lost, and
    // the custom cover too if the "Custom cover" option is selected.
    body.customDescription = previewDescriptionInput.value.trim();
    body.customCoverUrl = coverChoice === "custom" ? customCoverValue : null;
  }
  try {
    await jsonFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    if (t.dataset.mode === "queue") runQueue();
    if (t.dataset.mode === "manual") resetManualForm();
    if (t.dataset.mode === "mockup") resetMockupTool();
    if (t.dataset.mode === "copyright") resetCopyrightForm();
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
publishBtn.addEventListener("click", () => openPublishReviewForPreview(false));
publishCoverOnlyBtn.addEventListener("click", () => openPublishReviewForPreview(true));
saveBtn.addEventListener("click", () => toggleSave());
fileTypePdf.addEventListener("change", () => {
  if (fileTypePdf.checked) selectedFileType = "pdf";
  updateFileSizeDisplay();
});
fileTypeEpub.addEventListener("change", () => {
  if (fileTypeEpub.checked) selectedFileType = "epub";
  updateFileSizeDisplay();
});

function showCustomCoverPreview(src) {
  customCoverPreview.src = src;
  customCoverPreview.classList.remove("hidden");
  removeCustomCoverBtn.classList.remove("hidden");
  coverChoiceRadios.classList.remove("hidden");
  coverChoice = "custom";
  coverChoiceCustom.checked = true;
}

customCoverFile.addEventListener("change", () => {
  const file = customCoverFile.files && customCoverFile.files[0];
  if (!file) return;
  const MAX_UPLOAD_MB = 5;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    publishResult.textContent = `⚠️ Image is too large (max ${MAX_UPLOAD_MB}MB) — pick a smaller file.`;
    customCoverFile.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    customCoverValue = reader.result; // data:image/...;base64,...
    customCoverUrlInput.value = "";
    showCustomCoverPreview(customCoverValue);
  };
  reader.readAsDataURL(file);
});

useCoverUrlBtn.addEventListener("click", () => {
  const url = customCoverUrlInput.value.trim();
  if (!url) return;
  customCoverValue = url;
  customCoverFile.value = "";
  showCustomCoverPreview(url);
});

removeCustomCoverBtn.addEventListener("click", () => {
  customCoverValue = null;
  customCoverFile.value = "";
  customCoverUrlInput.value = "";
  customCoverPreview.classList.add("hidden");
  customCoverPreview.removeAttribute("src");
  removeCustomCoverBtn.classList.add("hidden");
  coverChoiceRadios.classList.add("hidden");
  coverChoice = "original";
  coverChoiceOriginal.checked = true;
});

coverChoiceOriginal.addEventListener("change", () => {
  if (coverChoiceOriginal.checked) coverChoice = "original";
});
coverChoiceCustom.addEventListener("change", () => {
  if (coverChoiceCustom.checked) coverChoice = "custom";
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
bulkQueueBtn.addEventListener("click", () => runBulkAddToQueue());

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

