// === 04: The book preview overlay — open/publish/schedule/save flow shared by every source tab ===

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
  previewDescriptionInput.value = "";
  previewDescriptionNote.classList.add("hidden");
  previewDescriptionNote.textContent = "";
  previewDescriptionResult.classList.add("hidden");
  previewDescriptionResult.innerHTML = "";
  rewriteDescriptionBtn.disabled = false;
  rewriteDescriptionBtn.textContent = "🪄 Rewrite with AI";
  currentHasCover = false;
  previewFileState.textContent = "";
  previewSourceLink.classList.add("hidden");
  previewSourceLink.removeAttribute("href");
  previewFileSize.textContent = "";
  previewFileSize.classList.add("hidden");
  previewFileSizeWarning.textContent = "";
  previewFileSizeWarning.classList.add("hidden");
  downloadLocalBtn.classList.add("hidden");
  downloadLocalBtn.removeAttribute("href");
  fileTypeChoice.classList.add("hidden");
  fileTypePdf.checked = true;
  coverChoice = "original";
  customCoverValue = null;
  customCoverFile.value = "";
  customCoverUrlInput.value = "";
  customCoverPreview.classList.add("hidden");
  customCoverPreview.removeAttribute("src");
  removeCustomCoverBtn.classList.add("hidden");
  coverChoiceRadios.classList.add("hidden");
  coverChoiceOriginal.checked = true;
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

    previewDescriptionInput.value = book.description || "";
    currentHasCover = !!book.cover_url;
    if (book.description_is_custom) {
      previewDescriptionNote.textContent = "✏️ Previously edited/rewritten — kept instead of the source's description.";
      previewDescriptionNote.classList.remove("hidden");
    }

    if (book.cover_url) {
      previewCoverImg.src = book.cover_url;
      previewCoverImg.classList.remove("hidden");
    } else {
      previewCoverFallback.classList.remove("hidden");
    }
    if (book.cover_is_custom && book.cover_url) {
      // Restores the "custom cover" choice from a previously saved/scheduled edit — same
      // treatment as the description restore right above, for the same reason.
      customCoverValue = book.cover_url;
      showCustomCoverPreview(book.cover_url);
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
      if (book.source_url) {
        previewSourceLink.href = book.source_url;
        previewSourceLink.classList.remove("hidden");
      }
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

// Shows a summary of exactly what's about to be sent to the Telegram channel — title,
// author, description (including any AI-rewritten/edited version), cover, and format —
// and waits for an explicit "Confirm & Publish" before `onConfirm` actually runs. Used by
// both the preview-screen publish flow and the "Add Manually" publish flow, each of which
// builds its own `fields` from its own form state and passes the right onConfirm callback.
function showPublishReview(fields, onConfirm) {
  pendingPublishFn = onConfirm;

  reviewSource.textContent = fields.source || "";
  reviewTitle.textContent = fields.title || "";
  reviewAuthor.textContent = fields.author || "";

  const desc = (fields.description || "").trim();
  if (desc) {
    reviewDescription.textContent = desc;
    reviewDescription.classList.remove("hidden");
  } else {
    reviewDescription.textContent = "";
    reviewDescription.classList.add("hidden");
  }

  if (fields.coverSrc) {
    reviewCoverImg.src = fields.coverSrc;
    reviewCoverImg.classList.remove("hidden");
    reviewCoverFallback.classList.add("hidden");
  } else {
    reviewCoverImg.classList.add("hidden");
    reviewCoverFallback.classList.remove("hidden");
  }

  const metaItems = [`<li><strong>Sending:</strong> ${fields.formatLabel}</li>`];
  if (fields.rating) {
    metaItems.push(`<li><strong>Rating:</strong> ${"⭐".repeat(fields.rating)}</li>`);
  }
  if (fields.category) {
    metaItems.push(`<li><strong>Category:</strong> ${fields.category}</li>`);
  }
  reviewMetaList.innerHTML = metaItems.join("");

  if (fields.alreadyPublished) {
    reviewDuplicateWarning.textContent = "⚠️ This book was already published before — confirming will publish it again.";
    reviewDuplicateWarning.classList.remove("hidden");
  } else {
    reviewDuplicateWarning.classList.add("hidden");
  }

  publishReviewOverlay.classList.remove("hidden");
}

// Preview-screen publish flow: pulls everything from the preview panel's current state.
function openPublishReviewForPreview(coverOnly) {
  const coverSrc = coverChoice === "custom" ? customCoverValue : previewCoverImg.src;
  showPublishReview(
    {
      source: previewSource.textContent,
      title: previewTitle.textContent,
      author: previewAuthor.textContent,
      description: previewDescriptionInput.value,
      coverSrc,
      formatLabel: coverOnly ? "Cover image only (no downloadable file)" : selectedFileType ? selectedFileType.toUpperCase() + " file" : "—",
      rating: currentSourceRating,
      category: currentCategory,
      alreadyPublished: forceRepublish,
    },
    () => publish(coverOnly)
  );
}

// "Add Manually" publish flow: pulls everything from the manual-entry form's current state.
function openPublishReviewForManual(coverOnly) {
  const coverSrc = manualCoverValue || (manualCoverPreview.classList.contains("hidden") ? null : manualCoverPreview.src);
  showPublishReview(
    {
      source: "Manual entry",
      title: manualTitleInput.value.trim(),
      author: manualAuthorInput.value.trim(),
      description: manualDescriptionInput.value,
      coverSrc,
      formatLabel: coverOnly ? "Cover image only (no downloadable file)" : (manualFileTypeEpub.checked ? "EPUB" : "PDF") + " file",
      rating: null,
      category: null,
      alreadyPublished: manualForceRepublish,
    },
    () => publishManual(coverOnly)
  );
}

closePublishReview.addEventListener("click", () => publishReviewOverlay.classList.add("hidden"));
cancelPublishReviewBtn.addEventListener("click", () => publishReviewOverlay.classList.add("hidden"));
publishReviewOverlay.addEventListener("click", (e) => {
  if (e.target === publishReviewOverlay) publishReviewOverlay.classList.add("hidden");
});
confirmPublishReviewBtn.addEventListener("click", () => {
  publishReviewOverlay.classList.add("hidden");
  if (pendingPublishFn) pendingPublishFn();
});

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
        customCoverUrl: coverChoice === "custom" ? customCoverValue : null,
        customDescription: previewDescriptionInput.value.trim(),
        channels: getSelectedChannelIds(),
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

rewriteDescriptionBtn.addEventListener("click", async () => {
  const title = previewTitle.textContent.trim();
  if (!title) return;

  rewriteDescriptionBtn.disabled = true;
  rewriteDescriptionBtn.textContent = "Rewriting…";
  previewDescriptionResult.innerHTML = "";
  previewDescriptionResult.textContent = "Asking Gemini to rewrite the description…";
  previewDescriptionResult.classList.remove("hidden");
  try {
    const data = await jsonFetch("/api/generate-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author: previewAuthor.textContent.trim(),
        description: previewDescriptionInput.value,
        has_cover: currentHasCover,
      }),
    });
    if (data.description) {
      previewDescriptionInput.value = data.description;
      previewDescriptionNote.textContent = "✏️ Rewritten with AI — review before publishing.";
      previewDescriptionNote.classList.remove("hidden");
      previewDescriptionResult.textContent = "✅ Description rewritten. Review it above before publishing.";
    } else {
      previewDescriptionResult.textContent = "⚠️ Gemini couldn't confidently write a description for this book — try editing it by hand instead.";
    }
  } catch (e) {
    previewDescriptionResult.textContent = `⚠️ ${e.message}`;
  } finally {
    rewriteDescriptionBtn.disabled = false;
    rewriteDescriptionBtn.textContent = "🪄 Rewrite with AI";
  }
});

// ===================== Manual entry (add a book by hand) =====================

function resetManualForm() {
  manualTitleInput.value = "";
  manualAuthorInput.value = "";
  manualDescriptionInput.value = "";
  extractInfoResult.classList.add("hidden");
  extractInfoResult.innerHTML = "";
  manualCoverValue = null;
  manualCoverFile.value = "";
  manualCoverUrlInput.value = "";
  manualCoverPreview.classList.add("hidden");
  manualCoverPreview.removeAttribute("src");
  manualRemoveCoverBtn.classList.add("hidden");
  manualFileValue = null;
  manualBookFile.value = "";
  manualFileUrlInput.value = "";
  manualBookFileName.classList.add("hidden");
  manualBookFileName.textContent = "";
  manualRemoveFileBtn.classList.add("hidden");
  manualFileTypeChoice.classList.add("hidden");
  manualFileTypePdf.checked = true;
  manualPublishResult.textContent = "";
  manualForceRepublish = false;
  manualPublishBtn.textContent = "Publish to Channel";
  manualPublishCoverOnlyBtn.textContent = "Publish Cover Only";
  manualIsSaved = false;
  manualSaveBtn.textContent = "💾 Save for Later";
  manualSaveBtn.classList.remove("saved");
  updateManualPublishButtons();
}

function updateManualPublishButtons() {
  const hasFile = !!manualFileValue;
  manualPublishBtn.classList.toggle("hidden", !hasFile);
  manualPublishCoverOnlyBtn.classList.toggle("hidden", hasFile);
}

