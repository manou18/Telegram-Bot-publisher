// === 13: Publish Queue tab — persistent drip-feed group scheduling ===
// Lets the user dump a whole batch of books in at once (from Saved Books, via the
// "🔁 Add Selected to Queue" bulk action) and have them trickle out to the channel
// automatically, one every N minutes/hours/days, for as long as the queue has items —
// unlike the existing "Schedule Selected" bulk action (03-browse-search.js) which fires
// every selected book at one single fixed date/time. The actual draining happens
// server-side on the existing 5-minute cron (see scheduled-publish.js + lib/publishQueue.js);
// this file is purely the UI for adding to / inspecting / reordering / pausing that queue.

function formatInterval(minutes) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// Splits a stored minute count back into the { value, unit } pair the settings form uses,
// picking the largest whole unit that divides it evenly (so 1440 shows as "1 day", not
// "1440 minutes") — purely a display nicety, the backend only ever stores minutes.
function splitIntervalMinutes(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

// --- Drag-and-drop reordering ---------------------------------------------------------
// Uses Pointer Events (not the HTML5 drag-and-drop API) specifically so this works on
// touch devices — iOS Safari in particular never fires native `dragstart` for touch
// input, and this list is exactly the kind of thing that's fiddly with tiny ⬆️/⬇️ buttons
// on a phone. The drag handle captures the pointer, and on every move we find the sibling
// row whose vertical midpoint the cursor has crossed and re-insert the dragged row there —
// live, so the list visibly reflows as you drag instead of just showing a drop target.

let queueDragEl = null; // the <li> currently being dragged, or null

function queueDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(".queue-item:not(.dragging)")];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

async function commitQueueOrder() {
  const orderedIds = Array.from(resultsList.querySelectorAll(".queue-item")).map((el) => el.dataset.id);
  try {
    await jsonFetch("/api/queue-reorder-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    runQueue(); // refresh so the "#N ·" labels and "next up around" estimates catch up
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
    runQueue(); // something went wrong server-side — reload the real order rather than trust the DOM
  }
}

function attachQueueDragHandlers(handle, li) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return; // left click / primary touch only
    e.preventDefault();
    queueDragEl = li;
    li.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (queueDragEl !== li) return;
    const after = queueDragAfterElement(resultsList, e.clientY);
    if (after == null) {
      resultsList.appendChild(li);
    } else if (after !== li.nextSibling) {
      resultsList.insertBefore(li, after);
    }
  });

  const endDrag = (e) => {
    if (queueDragEl !== li) return;
    queueDragEl = null;
    li.classList.remove("dragging");
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      // already released (e.g. pointercancel) — harmless
    }
    commitQueueOrder();
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

async function runQueue() {
  statusLine.textContent = "Loading queue…";
  nextPageBtn.classList.add("hidden");
  resultsList.innerHTML = "";
  try {
    const data = await jsonFetch("/api/queue-list");
    const records = data.records || [];
    const settings = data.settings || { enabled: false, intervalMinutes: 60 };

    const { value, unit } = splitIntervalMinutes(settings.intervalMinutes);
    queueEnabledToggle.checked = !!settings.enabled;
    queueIntervalValue.value = value;
    queueIntervalUnit.value = unit;

    const stateLabel = settings.enabled ? "🟢 running" : "⏸️ paused";
    const stuckCount = records.filter((r) => r.status === "stuck").length;
    const stuckLabel = stuckCount ? ` · 🛑 ${stuckCount} stuck` : "";
    statusLine.textContent = records.length
      ? `${records.length} book${records.length === 1 ? "" : "s"} in queue · every ${formatInterval(settings.intervalMinutes)} · ${stateLabel}${stuckLabel}`
      : `Queue is empty · every ${formatInterval(settings.intervalMinutes)} · ${stateLabel}`;

    records.forEach((r, i) => {
      const isStuck = r.status === "stuck";
      const li = document.createElement("li");
      li.className = `scheduled-item queue-item ${isStuck ? "status-stuck" : "status-pending"}`;
      li.dataset.id = r.id;

      const dragHandle = document.createElement("span");
      dragHandle.className = "drag-handle";
      dragHandle.textContent = "⠿";
      dragHandle.title = "Drag to reorder";
      dragHandle.setAttribute("aria-label", "Drag to reorder");
      attachQueueDragHandlers(dragHandle, li);
      li.appendChild(dragHandle);

      const title = document.createElement("div");
      title.className = "scheduled-item-title";
      title.textContent = `#${i + 1} · ${r.rating ? "⭐".repeat(r.rating) + " " : ""}${r.title}`;

      const meta = document.createElement("div");
      meta.className = "scheduled-item-meta";
      const when = new Date(r.estimatedFor).toLocaleString("en");
      const channelsLabel = channelNamesLabel(r.channels);
      const channelsSuffix = channelsLabel ? `  ·  📡 ${channelsLabel}` : "";
      meta.textContent = isStuck
        ? `${r.author}  —  ${r.source}  ·  paused after ${r.attempts || 0} failed attempts${channelsSuffix}`
        : `${r.author}  —  ${r.source}  ·  next up around ${when}${channelsSuffix}`;

      li.appendChild(title);
      li.appendChild(meta);

      if (isStuck) {
        const statusEl = document.createElement("span");
        statusEl.className = "scheduled-item-status stuck";
        statusEl.textContent = "🛑 Stuck";
        li.appendChild(document.createElement("br"));
        li.appendChild(statusEl);

        if (r.lastError) {
          const err = document.createElement("div");
          err.className = "scheduled-item-meta";
          err.textContent = r.lastError;
          li.appendChild(err);
        }
      }

      const actions = document.createElement("div");
      actions.className = "scheduled-item-actions";

      if (isStuck) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn-ghost";
        retryBtn.textContent = "🔁 Retry";
        retryBtn.addEventListener("click", async () => {
          retryBtn.disabled = true;
          try {
            await jsonFetch("/api/queue-retry", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: r.id }),
            });
            runQueue();
          } catch (e) {
            retryBtn.disabled = false;
            statusLine.textContent = `⚠️ ${e.message}`;
          }
        });
        actions.appendChild(retryBtn);
      }

      const publishNowBtn = document.createElement("button");
      publishNowBtn.className = "btn-ghost";
      publishNowBtn.textContent = "🚀 Publish now";
      publishNowBtn.title = "Publish this book immediately, without waiting for its turn in the queue.";
      publishNowBtn.addEventListener("click", async () => {
        publishNowBtn.disabled = true;
        publishNowBtn.textContent = "⏳ Publishing…";
        try {
          await jsonFetch("/api/queue-publish-now", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: r.id }),
          });
          statusLine.textContent = `✅ Published "${r.title}".`;
          runQueue();
        } catch (e) {
          statusLine.textContent = `⚠️ ${e.message}`;
          runQueue(); // refresh — a failed attempt may have moved this item to "stuck"
        }
      });
      actions.appendChild(publishNowBtn);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-ghost";
      removeBtn.textContent = "✕ Remove";
      removeBtn.addEventListener("click", async () => {
        removeBtn.disabled = true;
        try {
          await jsonFetch("/api/queue-remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: r.id }),
          });
          runQueue();
        } catch (e) {
          removeBtn.disabled = false;
          statusLine.textContent = `⚠️ ${e.message}`;
        }
      });

      actions.appendChild(removeBtn);
      li.appendChild(actions);

      resultsList.appendChild(li);
    });
  } catch (e) {
    statusLine.textContent = `⚠️ ${e.message}`;
  }
}

queueSaveSettingsBtn.addEventListener("click", async () => {
  const raw = Number(queueIntervalValue.value);
  if (!raw || raw <= 0) {
    queueSettingsStatus.textContent = "⚠️ Enter a valid interval.";
    return;
  }
  const multiplier = queueIntervalUnit.value === "days" ? 1440 : queueIntervalUnit.value === "hours" ? 60 : 1;
  const intervalMinutes = Math.max(5, Math.round(raw * multiplier));

  queueSaveSettingsBtn.disabled = true;
  queueSettingsStatus.textContent = "⏳ Saving…";
  try {
    await jsonFetch("/api/queue-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: queueEnabledToggle.checked, intervalMinutes }),
    });
    queueSettingsStatus.textContent = "✅ Saved.";
    runQueue();
  } catch (e) {
    queueSettingsStatus.textContent = `⚠️ ${e.message}`;
  }
  queueSaveSettingsBtn.disabled = false;
});

// Bulk action from the Saved Books tab: sends every checked book to /api/queue-add in one
// request (unlike executeBulkPublish/runBulkSchedule which call their endpoint once per
// book) — the queue itself doesn't care about ordering races the way a fixed-time batch
// might, so one round trip is simpler and just as safe.
async function runBulkAddToQueue() {
  const items = Array.from(bulkSelected);
  if (!items.length) return;

  const force = !!bulkQueueForce.checked;

  bulkPublishBtn.disabled = true;
  bulkScheduleBtn.disabled = true;
  bulkQueueBtn.disabled = true;
  bulkSelectAll.disabled = true;
  bulkPublishStatus.classList.remove("hidden");
  bulkPublishStatus.textContent = `⏳ Adding ${items.length} book${items.length === 1 ? "" : "s"} to the queue…`;

  try {
    const data = await jsonFetch("/api/queue-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        force,
        items: items.map((r) => ({
          source: r.source,
          item: r.item,
          category: r.category || null,
          publishCoverOnlyIfNoFile: true,
          channels: getSelectedChannelIds(),
        })),
      }),
    });
    const okCount = (data.added || []).length;
    const failed = data.failed || [];
    const skipped = data.skipped || [];

    const skipLabel = {
      already_published: "already published",
      already_scheduled: "already scheduled",
      already_queued: "already queued",
      likely_copyrighted: "⚠️ possibly copyrighted",
    };
    const lines = [];
    if (okCount) lines.push(`✅ Queued ${okCount} book${okCount === 1 ? "" : "s"}.`);
    if (skipped.length) {
      lines.push(
        `⏭️ Skipped ${skipped.length} (already in another list, or flagged by the copyright check) — tick "Include already published/scheduled/queued/possibly copyrighted" to force-add them:`
      );
      lines.push(
        ...skipped.map((s) => {
          const label = skipLabel[s.reason] || s.reason;
          const detail = s.reason === "likely_copyrighted" && s.copyright ? ` — ${s.copyright.summary}` : "";
          return `   • ${s.title} (${label})${detail}`;
        })
      );
    }
    if (failed.length) {
      lines.push(`⚠️ Failed ${failed.length}: ${failed.map((f) => f.title).join(", ")}`);
    }
    if (!lines.length) lines.push("Nothing to queue.");
    bulkPublishStatus.textContent = lines.join("\n");
  } catch (e) {
    bulkPublishStatus.textContent = `⚠️ ${e.message}`;
  }

  bulkSelected = new Set();
  bulkPublishBtn.disabled = false;
  bulkScheduleBtn.disabled = false;
  bulkQueueBtn.disabled = false;
  bulkSelectAll.disabled = false;
  bulkSelectAll.checked = false;
  bulkQueueForce.checked = false;
  renderResults(lastResults); // refresh so checkboxes clear (queued books stay in Saved)
}

// Auto-refresh while the Publish Queue tab is open. This is the one tab where "what
// changed on the server a moment ago" actually matters live — the cron drains it in the
// background every 5 minutes with no push notification back to the browser, so without
// this a user just watching the tab would only ever see it update by manually reloading.
// Checks `mode` on every tick (rather than starting/stopping the interval on tab
// switches) so there's only ever one interval running for the page's whole lifetime, and
// skips the request entirely while the tab is hidden/backgrounded so it doesn't burn
// function invocations no one is looking at.
const QUEUE_POLL_MS = 60000;
setInterval(() => {
  if (mode === "queue" && !document.hidden && !queueDragEl) runQueue();
}, QUEUE_POLL_MS);
