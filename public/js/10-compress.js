// === 10: Compress Cover (Tools ▸ Compress Cover) ===
// Self-contained, 100% client-side: resizes to a max width (keeping aspect ratio)
// and re-encodes via <canvas>.toBlob at a chosen quality/format. Nothing here touches
// the catalog/publish state or is sent to the channel. Must load after the HTML above
// exists; no dependency on the other split files.

const ccFileInput = document.getElementById("ccFileInput");
const ccOriginalPreview = document.getElementById("ccOriginalPreview");
const ccOriginalInfo = document.getElementById("ccOriginalInfo");
const ccMaxWidthSelect = document.getElementById("ccMaxWidthSelect");
const ccFormatSelect = document.getElementById("ccFormatSelect");
const ccQualityGroup = document.getElementById("ccQualityGroup");
const ccQualitySlider = document.getElementById("ccQualitySlider");
const ccQualityValue = document.getElementById("ccQualityValue");
const ccCompressBtn = document.getElementById("ccCompressBtn");
const ccDownloadBtn = document.getElementById("ccDownloadBtn");
const ccStatus = document.getElementById("ccStatus");
const ccResultWrap = document.getElementById("ccResultWrap");
const ccResultPreview = document.getElementById("ccResultPreview");
const ccResultInfo = document.getElementById("ccResultInfo");

let ccOriginalImage = null;
let ccOriginalFile = null;
let ccResultBlob = null;
let ccResultExt = "jpg";

function ccFormatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// PNG's "quality" argument to toBlob is ignored by every browser (it's always
// lossless), so the slider is only meaningful — and only shown as enabled — for
// JPEG/WEBP.
function ccUpdateQualityAvailability() {
  const isPng = ccFormatSelect.value === "image/png";
  ccQualitySlider.disabled = isPng;
  ccQualityGroup.style.opacity = isPng ? 0.5 : 1;
}
ccFormatSelect.onchange = ccUpdateQualityAvailability;
ccUpdateQualityAvailability();

ccQualitySlider.oninput = () => {
  ccQualityValue.textContent = `${ccQualitySlider.value}%`;
};

ccFileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    ccOriginalImage = img;
    ccOriginalFile = file;
    ccOriginalPreview.src = img.src;
    ccOriginalPreview.classList.remove("hidden");
    ccOriginalInfo.textContent = `${img.width}×${img.height} — ${ccFormatBytes(file.size)}`;
    ccOriginalInfo.classList.remove("hidden");
    ccCompressBtn.disabled = false;
    ccDownloadBtn.disabled = true;
    ccResultBlob = null;
    ccResultWrap.classList.add("hidden");
    ccStatus.textContent = "Ready to compress";
  };
  img.src = URL.createObjectURL(file);
};

ccCompressBtn.onclick = () => {
  if (!ccOriginalImage) return;

  ccCompressBtn.disabled = true;
  ccStatus.textContent = "Compressing...";

  const maxWidth = +ccMaxWidthSelect.value;
  const srcW = ccOriginalImage.width;
  const srcH = ccOriginalImage.height;
  let destW = srcW;
  let destH = srcH;
  if (maxWidth > 0 && srcW > maxWidth) {
    destW = maxWidth;
    destH = Math.round((srcH / srcW) * maxWidth);
  }

  const canvas = document.createElement("canvas");
  canvas.width = destW;
  canvas.height = destH;
  const ctx = canvas.getContext("2d");
  // Flatten onto white first: PNGs/WEBPs with transparency would otherwise turn
  // black when re-encoded as JPEG, which has no alpha channel.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, destW, destH);
  ctx.drawImage(ccOriginalImage, 0, 0, destW, destH);

  const format = ccFormatSelect.value;
  const quality = +ccQualitySlider.value / 100;

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        ccStatus.textContent = "Compression failed — try a different format";
        ccCompressBtn.disabled = false;
        return;
      }
      ccResultBlob = blob;
      ccResultExt = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";

      const url = URL.createObjectURL(blob);
      ccResultPreview.src = url;
      ccResultPreview.classList.remove("hidden");
      ccResultWrap.classList.remove("hidden");

      const reduction = ccOriginalFile ? Math.round((1 - blob.size / ccOriginalFile.size) * 100) : null;
      const reductionText = reduction !== null ? ` (${reduction >= 0 ? "-" : "+"}${Math.abs(reduction)}%)` : "";
      ccResultInfo.textContent = `${destW}×${destH} — ${ccFormatBytes(blob.size)}${reductionText}`;

      ccStatus.textContent = "Done!";
      ccCompressBtn.disabled = false;
      ccDownloadBtn.disabled = false;
    },
    format,
    format === "image/png" ? undefined : quality
  );
};

ccDownloadBtn.onclick = () => {
  if (!ccResultBlob) return;
  const link = document.createElement("a");
  link.download = `cover-compressed.${ccResultExt}`;
  link.href = URL.createObjectURL(ccResultBlob);
  link.click();
};
