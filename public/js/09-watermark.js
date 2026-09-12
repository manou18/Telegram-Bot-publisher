// === 09: Watermark Remover (Tools ▸ Remove Watermark) ===
// Self-contained, 100% client-side. Boundary-aware inpainting: Auto Mode targets a
// corner region, Manual Mode lets you paint a mask; a Texture-aware patch fill or a
// smooth Laplace-relaxation blend then fills the masked pixels. Nothing here touches
// the catalog/publish state or is sent to the channel — it only reads/writes the
// local canvas. Must load after the HTML above exists; no dependency on the other
// split files.

const wmCanvas = document.getElementById("wmCanvas");
const wmCtx = wmCanvas.getContext("2d", { willReadFrequently: true });
const wmFileInput = document.getElementById("wmFileInput");
const wmModeAutoBtn = document.getElementById("wmModeAuto");
const wmModeManualBtn = document.getElementById("wmModeManual");
const wmCornerSelect = document.getElementById("wmCornerSelect");
const wmBrushSize = document.getElementById("wmBrushSize");
const wmBrushValue = document.getElementById("wmBrushValue");
const wmQualitySlider = document.getElementById("wmQualitySlider");
const wmQualityValue = document.getElementById("wmQualityValue");
const wmFillStyleSelect = document.getElementById("wmFillStyleSelect");
const wmClearMaskBtn = document.getElementById("wmClearMaskBtn");
const wmRemoveBtn = document.getElementById("wmRemoveBtn");
const wmUndoBtn = document.getElementById("wmUndoBtn");
const wmCompareBtn = document.getElementById("wmCompareBtn");
const wmDownloadBtn = document.getElementById("wmDownloadBtn");
const wmStatus = document.getElementById("wmStatus");
const wmProgressWrap = document.getElementById("wmProgressWrap");
const wmProgressBar = document.getElementById("wmProgressBar");

let wmOriginalImage = null;
let wmIsManualMode = false;
let wmIsDrawing = false;
let wmMaskCanvas, wmMaskCtx;
let wmCurrentBrushSize = 28;
let wmLastResultImageData = null; // for undo (state before last removal)
let wmCurrentImageData = null;    // current pixel state shown on canvas

wmModeAutoBtn.onclick = () => {
  wmIsManualMode = false;
  wmModeAutoBtn.classList.add("active");
  wmModeManualBtn.classList.remove("active");
  wmCanvas.style.cursor = "default";
  wmStatus.textContent = "Auto Mode ready";
};

wmModeManualBtn.onclick = () => {
  wmIsManualMode = true;
  wmModeManualBtn.classList.add("active");
  wmModeAutoBtn.classList.remove("active");
  wmCanvas.style.cursor = "crosshair";
  wmStatus.textContent = "Manual Mode: paint over the watermark";
};

wmBrushSize.oninput = () => {
  wmCurrentBrushSize = +wmBrushSize.value;
  wmBrushValue.textContent = wmCurrentBrushSize;
};

wmQualitySlider.oninput = () => {
  const labels = ["Fast", "Medium", "High"];
  wmQualityValue.textContent = labels[wmQualitySlider.value - 1];
};

wmFileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    wmOriginalImage = img;
    wmCanvas.width = img.width;
    wmCanvas.height = img.height;

    wmMaskCanvas = document.createElement("canvas");
    wmMaskCanvas.width = img.width;
    wmMaskCanvas.height = img.height;
    wmMaskCtx = wmMaskCanvas.getContext("2d");
    wmMaskCtx.clearRect(0, 0, wmMaskCanvas.width, wmMaskCanvas.height);

    wmRedraw();
    wmCurrentImageData = wmCtx.getImageData(0, 0, wmCanvas.width, wmCanvas.height);
    wmLastResultImageData = null;
    wmUndoBtn.disabled = true;
    wmRemoveBtn.disabled = false;
    wmDownloadBtn.disabled = false;
    wmClearMaskBtn.disabled = false;
    wmCompareBtn.disabled = false;
    wmStatus.textContent = "Image loaded successfully";
  };
  img.src = URL.createObjectURL(file);
};

function wmRedraw() {
  if (!wmOriginalImage) return;
  wmCtx.clearRect(0, 0, wmCanvas.width, wmCanvas.height);
  wmCtx.drawImage(wmOriginalImage, 0, 0);
  if (wmMaskCanvas) {
    wmCtx.save();
    wmCtx.globalAlpha = 0.42;
    wmCtx.drawImage(wmMaskCanvas, 0, 0);
    wmCtx.restore();
  }
}

function wmGetPos(e) {
  const rect = wmCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (wmCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (wmCanvas.height / rect.height),
  };
}

function wmStartDraw(e) {
  if (!wmIsManualMode || !wmMaskCtx) return;
  wmIsDrawing = true;
  wmDraw(e);
}

function wmDraw(e) {
  if (!wmIsDrawing || !wmMaskCtx) return;
  const pos = wmGetPos(e);
  wmMaskCtx.beginPath();
  wmMaskCtx.fillStyle = "#ff0000";
  wmMaskCtx.arc(pos.x, pos.y, wmCurrentBrushSize / 2, 0, Math.PI * 2);
  wmMaskCtx.fill();
  wmRedraw();
}

wmCanvas.addEventListener("mousedown", wmStartDraw);
wmCanvas.addEventListener("mousemove", wmDraw);
wmCanvas.addEventListener("mouseup", () => (wmIsDrawing = false));
wmCanvas.addEventListener("mouseleave", () => (wmIsDrawing = false));

wmCanvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    wmStartDraw(e.touches[0]);
  },
  { passive: false }
);
wmCanvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    wmDraw(e.touches[0]);
  },
  { passive: false }
);
wmCanvas.addEventListener("touchend", () => (wmIsDrawing = false));

wmClearMaskBtn.onclick = () => {
  if (!wmMaskCtx) return;
  wmMaskCtx.clearRect(0, 0, wmMaskCanvas.width, wmMaskCanvas.height);
  wmRedraw();
  wmStatus.textContent = "Mask cleared";
};

// Hold-to-compare with original
wmCompareBtn.addEventListener("mousedown", () => {
  if (!wmOriginalImage) return;
  wmCtx.drawImage(wmOriginalImage, 0, 0);
});
wmCompareBtn.addEventListener("mouseup", () => {
  if (wmCurrentImageData) wmCtx.putImageData(wmCurrentImageData, 0, 0);
});
wmCompareBtn.addEventListener("mouseleave", () => {
  if (wmCurrentImageData) wmCtx.putImageData(wmCurrentImageData, 0, 0);
});

wmUndoBtn.onclick = () => {
  if (!wmLastResultImageData) return;
  wmCurrentImageData = wmLastResultImageData;
  wmCtx.putImageData(wmCurrentImageData, 0, 0);
  wmLastResultImageData = null;
  wmUndoBtn.disabled = true;
  wmStatus.textContent = "Reverted to previous state";
};

function wmBuildMask(width, height) {
  let mask = new Uint8Array(width * height);
  if (wmIsManualMode && wmMaskCanvas) {
    const mData = wmMaskCtx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < mask.length; i++) {
      mask[i] = mData[i * 4] > 100 ? 1 : 0;
    }
  } else {
    const regionSize = Math.min(width, height) * 0.15;
    let x1, y1, x2, y2;
    switch (wmCornerSelect.value) {
      case "bottom-right":
        x1 = width - regionSize;
        y1 = height - regionSize;
        x2 = width;
        y2 = height;
        break;
      case "bottom-left":
        x1 = 0;
        y1 = height - regionSize;
        x2 = regionSize;
        y2 = height;
        break;
      case "top-right":
        x1 = width - regionSize;
        y1 = 0;
        x2 = width;
        y2 = regionSize;
        break;
      case "top-left":
        x1 = 0;
        y1 = 0;
        x2 = regionSize;
        y2 = regionSize;
        break;
    }
    for (let y = Math.floor(y1); y < y2; y++) {
      for (let x = Math.floor(x1); x < x2; x++) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

// ---- Smooth fill: nearest-known seed + Gauss-Seidel relaxation ----
// Each masked pixel converges toward the average of its 4-neighbors, which follows
// the hole's shape and blends seamlessly instead of a fixed-radius blur.
function wmInitialFill(data, mask, width, height) {
  const maskIndices = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) maskIndices.push(i);

  for (const idx of maskIndices) {
    const x = idx % width,
      y = (idx / width) | 0;
    let found = false;
    for (let r = 1; r <= 40 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] === 1) continue;
          const pIdx = idx * 4,
            sIdx = nIdx * 4;
          data[pIdx] = data[sIdx];
          data[pIdx + 1] = data[sIdx + 1];
          data[pIdx + 2] = data[sIdx + 2];
          found = true;
        }
      }
    }
  }
  return maskIndices;
}

function wmRelax(data, maskIndices, width, height, iterations, onProgress, done) {
  let iter = 0;

  function step() {
    const end = Math.min(iterations, iter + Math.max(1, Math.floor(iterations / 40)));
    for (; iter < end; iter++) {
      for (const idx of maskIndices) {
        const x = idx % width,
          y = (idx / width) | 0;
        for (let c = 0; c < 3; c++) {
          let sum = 0,
            count = 0;
          if (x > 0) {
            sum += data[(idx - 1) * 4 + c];
            count++;
          }
          if (x < width - 1) {
            sum += data[(idx + 1) * 4 + c];
            count++;
          }
          if (y > 0) {
            sum += data[(idx - width) * 4 + c];
            count++;
          }
          if (y < height - 1) {
            sum += data[(idx + width) * 4 + c];
            count++;
          }
          if (count > 0) data[idx * 4 + c] = sum / count;
        }
      }
    }
    onProgress(iter / iterations);
    if (iter < iterations) {
      requestAnimationFrame(step);
    } else {
      done();
    }
  }
  requestAnimationFrame(step);
}

// ---- Texture-aware patch fill (exemplar-based) ----
// Searches the KNOWN part of the image for patches resembling the hole's border and
// copies real texture in, so photographic backgrounds keep their detail instead of
// turning into a smooth blur.
function wmTextureFill(data, mask, width, height, patchR, samples, onProgress, done) {
  const known = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) known[i] = mask[i] === 0 ? 1 : 0;

  function patchFullyKnown(cx, cy) {
    if (cx - patchR < 0 || cx + patchR >= width || cy - patchR < 0 || cy + patchR >= height) return false;
    for (let dy = -patchR; dy <= patchR; dy++) {
      const rowBase = (cy + dy) * width;
      for (let dx = -patchR; dx <= patchR; dx++) {
        if (known[rowBase + cx + dx] === 0) return false;
      }
    }
    return true;
  }

  function ssd(cx, cy, kx, ky) {
    let sum = 0;
    for (let dy = -patchR; dy <= patchR; dy++) {
      const rowA = (cy + dy) * width,
        rowB = (ky + dy) * width;
      for (let dx = -patchR; dx <= patchR; dx++) {
        const aIdx = rowA + (cx + dx);
        if (known[aIdx] === 0) continue;
        const bIdx = (rowB + (kx + dx)) * 4;
        const aPix = aIdx * 4;
        const dr = data[aPix] - data[bIdx];
        const dg = data[aPix + 1] - data[bIdx + 1];
        const db = data[aPix + 2] - data[bIdx + 2];
        sum += dr * dr + dg * dg + db * db;
      }
    }
    return sum;
  }

  function remainingBorder() {
    const border = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (known[idx] === 1) continue;
        let hasKnownNeighbor = false;
        for (let dy = -1; dy <= 1 && !hasKnownNeighbor; dy++) {
          for (let dx = -1; dx <= 1 && !hasKnownNeighbor; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (known[ny * width + nx] === 1) hasKnownNeighbor = true;
          }
        }
        if (hasKnownNeighbor) border.push(idx);
      }
    }
    return border;
  }

  let totalToFill = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) totalToFill++;
  let filledCount = 0;

  function ring() {
    const border = remainingBorder();
    if (border.length === 0) {
      done();
      return;
    }

    const updates = [];
    for (const idx of border) {
      const x = idx % width,
        y = (idx / width) | 0;
      if (x - patchR < 0 || x + patchR >= width || y - patchR < 0 || y + patchR >= height) {
        updates.push([idx, null]);
        continue;
      }
      let bestScore = Infinity,
        bestX = -1,
        bestY = -1;
      for (let s = 0; s < samples; s++) {
        const kx = patchR + Math.floor(Math.random() * (width - 2 * patchR));
        const ky = patchR + Math.floor(Math.random() * (height - 2 * patchR));
        if (!patchFullyKnown(kx, ky)) continue;
        const score = ssd(x, y, kx, ky);
        if (score < bestScore) {
          bestScore = score;
          bestX = kx;
          bestY = ky;
        }
      }
      if (bestX >= 0) {
        const srcPix = (bestY * width + bestX) * 4;
        updates.push([idx, [data[srcPix], data[srcPix + 1], data[srcPix + 2]]]);
      } else {
        updates.push([idx, null]);
      }
    }

    // Fallback: simple neighbor average for any pixel with no valid candidate.
    for (const [idx, color] of updates) {
      const pIdx = idx * 4;
      if (color) {
        data[pIdx] = color[0];
        data[pIdx + 1] = color[1];
        data[pIdx + 2] = color[2];
      } else {
        const x = idx % width,
          y = (idx / width) | 0;
        let r = 0,
          g = 0,
          b = 0,
          c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (known[nIdx] === 0) continue;
            const nPix = nIdx * 4;
            r += data[nPix];
            g += data[nPix + 1];
            b += data[nPix + 2];
            c++;
          }
        if (c > 0) {
          data[pIdx] = r / c;
          data[pIdx + 1] = g / c;
          data[pIdx + 2] = b / c;
        }
      }
      known[idx] = 1;
    }
    filledCount += updates.length;
    onProgress(Math.min(1, filledCount / totalToFill));
    requestAnimationFrame(ring);
  }
  requestAnimationFrame(ring);
}

wmRemoveBtn.onclick = () => {
  if (!wmOriginalImage || !wmCurrentImageData) return;

  wmLastResultImageData = wmCurrentImageData; // snapshot for undo
  wmUndoBtn.disabled = false;

  wmRemoveBtn.disabled = true;
  wmClearMaskBtn.disabled = true;
  wmStatus.textContent = "Filling watermark region...";
  wmProgressWrap.style.display = "block";
  wmProgressBar.style.width = "0%";

  const width = wmCanvas.width,
    height = wmCanvas.height;
  const imageData = wmCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const mask = wmBuildMask(width, height);
  const quality = +wmQualitySlider.value; // 1, 2, 3
  const fillStyle = wmFillStyleSelect.value;

  let maskHasPixels = false;
  for (let i = 0; i < mask.length; i++)
    if (mask[i] === 1) {
      maskHasPixels = true;
      break;
    }
  if (!maskHasPixels) {
    wmStatus.textContent = "No watermark region selected";
    wmProgressWrap.style.display = "none";
    wmRemoveBtn.disabled = false;
    wmClearMaskBtn.disabled = false;
    return;
  }

  const finish = () => {
    wmCtx.putImageData(imageData, 0, 0);
    wmCurrentImageData = imageData;
    if (wmMaskCtx) wmMaskCtx.clearRect(0, 0, width, height);
    wmProgressWrap.style.display = "none";
    wmRemoveBtn.disabled = false;
    wmClearMaskBtn.disabled = false;
    wmStatus.textContent = "Done!";
  };

  if (fillStyle === "texture") {
    const patchRByQuality = { 1: 3, 2: 4, 3: 5 };
    const samplesByQuality = { 1: 60, 2: 150, 3: 300 };
    wmStatus.textContent = "Copying matching texture...";
    wmTextureFill(
      data,
      mask,
      width,
      height,
      patchRByQuality[quality],
      samplesByQuality[quality],
      (p) => {
        wmProgressBar.style.width = Math.round(p * 100) + "%";
        wmCtx.putImageData(imageData, 0, 0);
      },
      finish
    );
  } else {
    const iterationsByQuality = { 1: 60, 2: 160, 3: 320 };
    const iterations = iterationsByQuality[quality];
    wmStatus.textContent = "Blending surrounding colors...";
    const maskIndices = wmInitialFill(data, mask, width, height);
    wmCtx.putImageData(imageData, 0, 0); // show quick seed immediately
    wmRelax(
      data,
      maskIndices,
      width,
      height,
      iterations,
      (p) => {
        wmProgressBar.style.width = Math.round(p * 100) + "%";
        wmCtx.putImageData(imageData, 0, 0);
      },
      finish
    );
  }
};

wmDownloadBtn.onclick = () => {
  const link = document.createElement("a");
  link.download = "cleaned-image.png";
  link.href = wmCanvas.toDataURL("image/png");
  link.click();
};
