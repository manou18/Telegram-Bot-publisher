// === 08: Grouped-tab navigation + header "More" menu ===
// Purely additive UI wiring — doesn't touch setMode()/tabs logic in 02-api-utils.js or
// 06-manual-save.js. The 8 real tabs (.tab[data-mode]) still work exactly as before;
// this just shows/hides which row of them is visible, grouped under 3 pills, so the
// controls area doesn't show all 8 at once. Must load after the HTML above exists, but
// has no dependency on the other split files, so its position among them doesn't matter.

const modeGroupBtns = document.querySelectorAll(".mode-group");
const modeTabRows = document.querySelectorAll(".mode-tabs[data-group]");

modeGroupBtns.forEach((groupBtn) => {
  groupBtn.addEventListener("click", () => {
    modeGroupBtns.forEach((b) => b.classList.toggle("active", b === groupBtn));
    modeTabRows.forEach((row) =>
      row.classList.toggle("hidden", row.dataset.group !== groupBtn.dataset.group)
    );
  });
});

// Header "More" menu (Stats / Sources / Export / Import) — a simple click-to-toggle
// dropdown. Closes on an outside click or after any item inside it is clicked, since
// every one of those buttons opens its own overlay or file picker anyway.
const moreMenuBtn = document.getElementById("moreMenuBtn");
const moreMenuPanel = document.getElementById("moreMenuPanel");

function closeMoreMenu() {
  moreMenuPanel.classList.add("hidden");
  moreMenuBtn.setAttribute("aria-expanded", "false");
}

moreMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !moreMenuPanel.classList.contains("hidden");
  if (isOpen) {
    closeMoreMenu();
  } else {
    moreMenuPanel.classList.remove("hidden");
    moreMenuBtn.setAttribute("aria-expanded", "true");
  }
});
moreMenuPanel.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") closeMoreMenu();
});
document.addEventListener("click", (e) => {
  if (!moreMenuPanel.classList.contains("hidden") && !e.target.closest(".more-menu")) {
    closeMoreMenu();
  }
});
