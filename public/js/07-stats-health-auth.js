// === 07: Stats + Sources-health overlays, export/import, and login/unlock (must load last — runs init() on page load) ===

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
  if (typeof data.totalViews === "number") {
    statsContent.appendChild(statsRow("Total views 👁", data.totalViews.toLocaleString("en")));
  }

  if (data.queue) {
    statsContent.appendChild(statsSectionTitle("Publish Queue"));
    const q = data.queue;
    const stateLabel = q.enabled ? "🟢 running" : "⏸️ paused";
    statsContent.appendChild(statsRow("In queue", `${q.total}${q.stuck ? ` (🛑 ${q.stuck} stuck)` : ""}`));
    statsContent.appendChild(statsRow("State", `${stateLabel} · every ${q.intervalMinutes}m`));
    statsContent.appendChild(
      statsRow("Last queue publish", q.lastPublishedAt ? new Date(q.lastPublishedAt).toLocaleString("en") : "Never")
    );
  }

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

  if (data.topViewed && data.topViewed.length) {
    statsContent.appendChild(statsSectionTitle("Most viewed 👁"));
    data.topViewed.forEach((b) => {
      statsContent.appendChild(statsRow(`${b.title} — ${b.author}`, b.views.toLocaleString("en")));
    });
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
      const viewsPart = b.views ? ` · 👁 ${b.views.toLocaleString("en")}` : "";
      meta.textContent = `${b.author}${when ? " · " + when : ""}${viewsPart}`;

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

  if (data.queue) {
    healthContent.appendChild(statsSectionTitle("Publish Queue"));
    const q = data.queue;
    const stateLabel = q.enabled ? "🟢 running" : "⏸️ paused";
    healthContent.appendChild(statsRow("In queue", `${q.total}${q.stuck ? ` (🛑 ${q.stuck} stuck)` : ""}`));
    healthContent.appendChild(statsRow("State", `${stateLabel} · every ${q.intervalMinutes}m`));
    healthContent.appendChild(
      statsRow("Last queue publish", q.lastPublishedAt ? new Date(q.lastPublishedAt).toLocaleString("en") : "Never")
    );
  }

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
  await loadChannels();
  statusLine.textContent = "Choose a source above to browse, or switch to Search.";
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

