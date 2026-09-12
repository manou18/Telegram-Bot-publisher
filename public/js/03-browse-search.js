// === 03: Browse / Search / Archive.org Collection / Saved / Scheduled tabs, plus bulk publish/schedule ===

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
  currentSearchQuery = q; // drives the relevance sort in renderResults()
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
      const channelsLabel = channelNamesLabel(r.channels);
      meta.textContent = `${r.author}  —  ${r.source}  ·  scheduled for ${when}${
        channelsLabel ? `  ·  📡 ${channelsLabel}` : ""
      }`;

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
        customDescription: previewDescriptionInput.value.trim(),
        customCoverUrl: coverChoice === "custom" ? customCoverValue : null,
        channels: getSelectedChannelIds(),
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

// Shows the list of currently-checked Saved Books and waits for an explicit
// "Confirm & Publish All" before executeBulkPublish() actually sends anything.
function runBulkPublish() {
  const items = Array.from(bulkSelected);
  if (!items.length) return;

  bulkReviewSummary.textContent = `About to publish ${items.length} book${items.length === 1 ? "" : "s"} to the channel:`;
  bulkReviewList.innerHTML = items.map((r) => `<li>${r.line.replace(/^📌\s*/, "")}</li>`).join("");
  bulkPublishReviewOverlay.classList.remove("hidden");
}

closeBulkPublishReview.addEventListener("click", () => bulkPublishReviewOverlay.classList.add("hidden"));
cancelBulkPublishReviewBtn.addEventListener("click", () => bulkPublishReviewOverlay.classList.add("hidden"));
bulkPublishReviewOverlay.addEventListener("click", (e) => {
  if (e.target === bulkPublishReviewOverlay) bulkPublishReviewOverlay.classList.add("hidden");
});
confirmBulkPublishReviewBtn.addEventListener("click", () => {
  bulkPublishReviewOverlay.classList.add("hidden");
  executeBulkPublish(Array.from(bulkSelected));
});

async function executeBulkPublish(items) {
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
          channels: getSelectedChannelIds(),
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
// with the same flood-control delay as executeBulkPublish. All sharing one scheduledFor is
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
          channels: getSelectedChannelIds(),
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
  else if (mode === "queue") runQueue();
  else runCollection(useNext);
}

