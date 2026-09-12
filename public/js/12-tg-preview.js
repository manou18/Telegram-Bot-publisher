// === 12: Telegram Preview (Tools ▸ Telegram Preview) ===
// Self-contained, 100% client-side. Rebuilds the exact caption string the publish
// step sends — same emoji, bold title, rating line, and description truncation as
// sendCoverAndCaption() in netlify/lib/telegram.js — so what's shown here is what
// would actually be posted, not a rough approximation. Nothing here is sent to the
// channel or to any server. Must load after the HTML above exists; no dependency
// on the other split files.

const tgTitleInput = document.getElementById("tgTitleInput");
const tgAuthorInput = document.getElementById("tgAuthorInput");
const tgSourceInput = document.getElementById("tgSourceInput");
const tgRatingInput = document.getElementById("tgRatingInput");
const tgDescriptionInput = document.getElementById("tgDescriptionInput");
const tgCoverFile = document.getElementById("tgCoverFile");
const tgCoverPreview = document.getElementById("tgCoverPreview");
const tgRemoveCoverBtn = document.getElementById("tgRemoveCoverBtn");
const tgCoverUrlInput = document.getElementById("tgCoverUrlInput");
const tgUseCoverUrlBtn = document.getElementById("tgUseCoverUrlBtn");
const tgChannelNameInput = document.getElementById("tgChannelNameInput");
const tgCharCount = document.getElementById("tgCharCount");
const tgBubbleChannelName = document.getElementById("tgBubbleChannelName");
const tgBubbleImage = document.getElementById("tgBubbleImage");
const tgBubbleCaption = document.getElementById("tgBubbleCaption");

let tgCoverDataUrl = null;

// --- Mirrors netlify/lib/telegram.js exactly (escapeHtml / truncate / caption template) ---
function tgEscapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tgTruncate(text, max) {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

function tgBuildCaption() {
  const title = tgTitleInput.value.trim() || "Untitled";
  const author = tgAuthorInput.value.trim() || "Unknown";
  const source = tgSourceInput.value.trim() || "Manual";
  const description = tgDescriptionInput.value;
  const rating = tgRatingInput.value === "" ? null : Number(tgRatingInput.value);
  const hasCover = !!tgCoverDataUrl;

  const maxDescLen = hasCover ? 500 : 1500;
  const descriptionPart = description.trim()
    ? `\n\n📝 ${tgEscapeHtml(tgTruncate(description, maxDescLen))}`
    : "";

  let ratingPart = "";
  if (typeof rating === "number" && !Number.isNaN(rating) && rating > 0) {
    const display = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
    ratingPart = `\n${"⭐".repeat(Math.round(rating))} (${display}/5 — reader rating)`;
  }

  const caption = `📚 <b>${tgEscapeHtml(title)}</b>\n✍️ ${tgEscapeHtml(author)}\n📖 ${tgEscapeHtml(source)}${ratingPart}${descriptionPart}`;
  return { caption, hasCover };
}

function tgUpdatePreview() {
  const { caption, hasCover } = tgBuildCaption();

  tgBubbleCaption.innerHTML = caption;
  tgBubbleChannelName.textContent = tgChannelNameInput.value.trim() || "Channel";

  // Telegram counts the caption as UTF-16 code units, same as JS string length, and
  // that's measured on the raw (unescaped) text it actually sends — not the HTML
  // markup used only for rendering here, so strip the <b> tags before counting.
  const rawLength = caption.replace(/<\/?b>/g, "").length;
  const limit = hasCover ? 1024 : 4096;
  tgCharCount.textContent = `${rawLength} / ${limit}`;
  tgCharCount.classList.toggle("tg-char-warn", rawLength > limit);

  if (hasCover) {
    tgBubbleImage.src = tgCoverDataUrl;
    tgBubbleImage.classList.remove("hidden");
  } else {
    tgBubbleImage.classList.add("hidden");
  }
}

[tgTitleInput, tgAuthorInput, tgSourceInput, tgRatingInput, tgDescriptionInput, tgChannelNameInput].forEach((el) =>
  el.addEventListener("input", tgUpdatePreview)
);

function tgSetCover(dataUrl) {
  tgCoverDataUrl = dataUrl;
  if (dataUrl) {
    tgCoverPreview.src = dataUrl;
    tgCoverPreview.classList.remove("hidden");
    tgRemoveCoverBtn.classList.remove("hidden");
  } else {
    tgCoverPreview.classList.add("hidden");
    tgRemoveCoverBtn.classList.add("hidden");
  }
  tgUpdatePreview();
}

tgCoverFile.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => tgSetCover(reader.result);
  reader.readAsDataURL(file);
};

tgRemoveCoverBtn.onclick = () => {
  tgCoverFile.value = "";
  tgCoverUrlInput.value = "";
  tgSetCover(null);
};

tgUseCoverUrlBtn.onclick = () => {
  const url = tgCoverUrlInput.value.trim();
  if (!url) return;
  tgCoverFile.value = "";
  tgSetCover(url);
};

tgUpdatePreview();
