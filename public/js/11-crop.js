// === 11: Crop Cover (Tools ▸ Crop Cover) ===
// Self-contained, 100% client-side: drag a selection rectangle on the canvas (in
// real image pixels — same scaling approach as the watermark canvas), optionally
// locked to an aspect ratio, then crop + re-encode via <canvas>.toBlob. Nothing
// here touches the catalog/publish state or is sent to the channel. Must load
// after the HTML above exists; no dependency on the other split files.

const crCanvas = document.getElementById("crCanvas");
const crCtx = crCanvas.getContext("2d");
const crFileInput = document.getElementById("crFileInput");
const crAspectSelect = document.getElementById("crAspectSelect");
const crFormatSelect = document.getElementById("crFormatSelect");
const crQualityGroup = document.getElementById("crQualityGroup");
const crQualitySlider = document.getElementById("crQualitySlider");
const crQualityValue = document.getElementById("crQualityValue");
const crResetBtn = document.getElementById("crResetBtn");
const crApplyBtn = document.getElementById("crApplyBtn");
const crDownloadBtn = document.getElementById("crDownloadBtn");
const crStatus = document.getElementById("crStatus");
const crResultWrap = document.getElementById("crResultWrap");
const crResultPreview = document.getElementById("crResultPreview");
const crResultInfo = document.getElementById("crResultInfo");

let crImage = null;
let crSelection = null; // { x, y, w, h } in real image-pixel coordinates
let crDragStart = null;
let crIsDragging = false;
let crResultBlob = null;
let crResultExt = "jpg";

function crFormatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function crUpdateQualityAvailability() {
  const isPng = crFormatSelect.value === "image/png";
  crQualitySlider.disabled = isPng;
  crQualityGroup.style.opacity = isPng ? 0.5 : 1;
}
crFormatSelect.onchange = crUpdateQualityAvailability;
crUpdateQualityAvailability();

crQualitySlider.oninput = () => {
  crQualityValue.textContent = `${crQualitySlider.value}%`;
};

function crFullSelection() {
  return { x: 0, y: 0, w: crCanvas.width, h: crCanvas.height };
}

// Whenever the aspect lock changes, re-center a selection at that ratio (as large
// as fits) rather than trying to reinterpret whatever free-form rectangle was
// there before.
function crCenteredSelectionForAspect(aspect) {
  const cw = crCanvas.width,
    ch = crCanvas.height;
  let w = cw,
    h = cw / aspect;
  if (h > ch) {
    h = ch;
    w = ch * aspect;
  }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

crAspectSelect.onchange = () => {
  if (!crImage) return;
  const aspect = +crAspectSelect.value;
  crSelection = aspect > 0 ? crCenteredSelectionForAspect(aspect) : crFullSelection();
  crRedraw();
};

crFileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    crImage = img;
    crCanvas.width = img.width;
    crCanvas.height = img.height;

    const aspect = +crAspectSelect.value;
    crSelection = aspect > 0 ? crCenteredSelectionForAspect(aspect) : crFullSelection();

    crRedraw();
    crResetBtn.disabled = false;
    crApplyBtn.disabled = false;
    crDownloadBtn.disabled = true;
    crResultBlob = null;
    crResultWrap.classList.add("hidden");
    crStatus.textContent = "Drag on the image to select an area, or apply the full image as-is";
  };
  img.src = URL.createObjectURL(file);
};

function crRedraw() {
  if (!crImage) return;
  const w = crCanvas.width,
    h = crCanvas.height;
  crCtx.clearRect(0, 0, w, h);
  crCtx.drawImage(crImage, 0, 0);

  if (!crSelection) return;
  const { x, y, w: sw, h: sh } = crSelection;

  // Dim everything outside the selection (four rectangles around it) instead of a
  // composite-mode cutout, so it degrades gracefully on any canvas implementation.
  crCtx.save();
  crCtx.fillStyle = "rgba(4, 8, 24, 0.55)";
  crCtx.fillRect(0, 0, w, y); // top
  crCtx.fillRect(0, y + sh, w, h - (y + sh)); // bottom
  crCtx.fillRect(0, y, x, sh); // left
  crCtx.fillRect(x + sw, y, w - (x + sw), sh); // right
  crCtx.restore();

  crCtx.save();
  crCtx.strokeStyle = "#d9a441";
  crCtx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.003));
  crCtx.setLineDash([Math.max(6, w * 0.01), Math.max(4, w * 0.007)]);
  crCtx.strokeRect(x, y, sw, sh);
  crCtx.restore();
}

function crGetPos(e) {
  const rect = crCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (crCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (crCanvas.height / rect.height);
  return {
    x: Math.max(0, Math.min(crCanvas.width, x)),
    y: Math.max(0, Math.min(crCanvas.height, y)),
  };
}

function crRectFromDrag(start, cur, aspect) {
  let dx = cur.x - start.x,
    dy = cur.y - start.y;

  if (aspect > 0) {
    const signX = dx < 0 ? -1 : 1,
      signY = dy < 0 ? -1 : 1;
    const width = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
    dx = signX * width;
    dy = signY * (width / aspect);
  }

  let x = start.x,
    y = start.y,
    w = dx,
    h = dy;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }

  // Clamp inside the canvas without distorting the locked ratio — shrink from
  // whichever edge overflows.
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > crCanvas.width) w = crCanvas.width - x;
  if (y + h > crCanvas.height) h = crCanvas.height - y;

  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

crCanvas.addEventListener("mousedown", (e) => {
  if (!crImage) return;
  crIsDragging = true;
  crDragStart = crGetPos(e);
});
crCanvas.addEventListener("mousemove", (e) => {
  if (!crIsDragging || !crDragStart) return;
  const cur = crGetPos(e);
  crSelection = crRectFromDrag(crDragStart, cur, +crAspectSelect.value);
  crRedraw();
});
window.addEventListener("mouseup", () => {
  crIsDragging = false;
  crDragStart = null;
});

crCanvas.addEventListener(
  "touchstart",
  (e) => {
    if (!crImage) return;
    e.preventDefault();
    crIsDragging = true;
    crDragStart = crGetPos(e.touches[0]);
  },
  { passive: false }
);
crCanvas.addEventListener(
  "touchmove",
  (e) => {
    if (!crIsDragging || !crDragStart) return;
    e.preventDefault();
    const cur = crGetPos(e.touches[0]);
    crSelection = crRectFromDrag(crDragStart, cur, +crAspectSelect.value);
    crRedraw();
  },
  { passive: false }
);
crCanvas.addEventListener("touchend", () => {
  crIsDragging = false;
  crDragStart = null;
});

crResetBtn.onclick = () => {
  if (!crImage) return;
  const aspect = +crAspectSelect.value;
  crSelection = aspect > 0 ? crCenteredSelectionForAspect(aspect) : crFullSelection();
  crRedraw();
  crStatus.textContent = "Selection reset";
};

crApplyBtn.onclick = () => {
  if (!crImage || !crSelection) return;

  crApplyBtn.disabled = true;
  crStatus.textContent = "Cropping...";

  const { x, y, w, h } = crSelection;
  const sx = Math.round(x),
    sy = Math.round(y),
    sw = Math.round(w),
    sh = Math.round(h);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = sw;
  outCanvas.height = sh;
  const outCtx = outCanvas.getContext("2d");
  // Flatten onto white first: source transparency would otherwise turn black when
  // re-encoded as JPEG, which has no alpha channel.
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, sw, sh);
  outCtx.drawImage(crImage, sx, sy, sw, sh, 0, 0, sw, sh);

  const format = crFormatSelect.value;
  const quality = +crQualitySlider.value / 100;

  outCanvas.toBlob(
    (blob) => {
      if (!blob) {
        crStatus.textContent = "Crop failed — try a different format";
        crApplyBtn.disabled = false;
        return;
      }
      crResultBlob = blob;
      crResultExt = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";

      crResultPreview.src = URL.createObjectURL(blob);
      crResultPreview.classList.remove("hidden");
      crResultWrap.classList.remove("hidden");
      crResultInfo.textContent = `${sw}×${sh} — ${crFormatBytes(blob.size)}`;

      crStatus.textContent = "Done!";
      crApplyBtn.disabled = false;
      crDownloadBtn.disabled = false;
    },
    format,
    format === "image/png" ? undefined : quality
  );
};

crDownloadBtn.onclick = () => {
  if (!crResultBlob) return;
  const link = document.createElement("a");
  link.download = `cover-cropped.${crResultExt}`;
  link.href = URL.createObjectURL(crResultBlob);
  link.click();
};
