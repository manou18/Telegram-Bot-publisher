const sharp = require("sharp");

const COVER_HEIGHT = 800;

// Muted, warm/cool book-spine tones for the out-of-focus shelf background — kept desaturated
// on purpose (a busy, saturated shelf would compete with the actual book cover in the photo).
const SHELF_PALETTE = [
  "#7a4a35", "#8c5e3c", "#5c4632", "#9c7b4f", "#3f5142",
  "#4a5568", "#6b3f3f", "#7d6b4f", "#354a5f", "#5a4a3f",
  "#8a6d4a", "#4f5d4a", "#6f4f5f", "#3a3a3a",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Builds a purely procedural (no photo assets, no external service) "book on a shelf"
// background: a heavily-blurred row of book-spine-like rectangles behind wooden shelf
// boards for the upper portion, and a lightly textured table/counter surface below,
// with a soft contact-shadow line where they meet. Everything is one SVG rasterized by
// sharp, so there's no extra compositing pass just for the scene itself.
function buildSceneSvg(width, height, horizonY) {
  const shelfRows = [];
  const rowCount = Math.max(3, Math.round((horizonY / height) * 6));
  const rowHeight = horizonY / rowCount;

  for (let r = 0; r < rowCount; r++) {
    const rowTop = r * rowHeight;
    // Wooden shelf board under each row of "books".
    shelfRows.push(
      `<rect x="0" y="${rowTop + rowHeight - rowHeight * 0.08}" width="${width}" height="${rowHeight * 0.08}" fill="#3e2a1a" opacity="0.55"/>`
    );
    let x = 0;
    while (x < width) {
      const w = 18 + Math.random() * 30;
      const bookH = rowHeight * (0.7 + Math.random() * 0.28);
      const y = rowTop + (rowHeight * 0.92 - bookH);
      shelfRows.push(`<rect x="${x}" y="${y}" width="${w}" height="${bookH}" fill="${pick(SHELF_PALETTE)}"/>`);
      x += w;
    }
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shelfBlur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${Math.round(width * 0.012)}"/>
      </filter>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.08 0"/>
      </filter>
      <linearGradient id="surfaceGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c7c4bd"/>
        <stop offset="100%" stop-color="#e7e5df"/>
      </linearGradient>
      <linearGradient id="horizonShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
        <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>
      </radialGradient>
    </defs>

    <rect width="${width}" height="${horizonY}" fill="#2a1f16"/>
    <g filter="url(#shelfBlur)">${shelfRows.join("")}</g>

    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" fill="url(#surfaceGrad)"/>
    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" filter="url(#grain)"/>
    <rect x="0" y="${horizonY - height * 0.06}" width="${width}" height="${height * 0.1}" fill="url(#horizonShade)"/>

    <rect width="${width}" height="${height}" fill="url(#vignette)"/>
  </svg>`;
}

// Builds a lightweight "book on a shelf" mockup from a flat cover image: a slight shear
// to suggest the cover is standing at an angle, a darker spine strip along the left edge,
// a thin page-edge sliver on the right, a soft diagonal gloss highlight, a two-layer
// contact+cast shadow, and a procedurally-generated blurred-shelf/table background behind
// it. Everything is done with sharp/libvips + inline SVG locally — no external mockup
// service, no photo/template assets — so it works for any cover size or aspect ratio.
// Returns a PNG buffer ready to upload straight to Telegram.
async function buildCoverMockup(coverUrl) {
  let coverBuffer;
  if (coverUrl.startsWith("data:")) {
    // A manually uploaded cover arrives as a data: URI (base64) rather than a fetchable URL.
    const base64 = coverUrl.split(",")[1] || "";
    coverBuffer = Buffer.from(base64, "base64");
  } else {
    const res = await fetch(coverUrl);
    if (!res.ok) throw new Error(`Failed to download cover (HTTP ${res.status})`);
    coverBuffer = Buffer.from(await res.arrayBuffer());
  }

  const meta = await sharp(coverBuffer).rotate().metadata();
  const coverWidth = Math.round(((meta.width || 1) / (meta.height || 1)) * COVER_HEIGHT);

  const resizedCover = await sharp(coverBuffer)
    .rotate() // respect EXIF orientation before we do any of our own transforms
    .resize({ height: COVER_HEIGHT, width: coverWidth, fit: "fill" })
    .toBuffer();

  // ---- Spine: a darkened, gradient-shaded strip along the left edge (darkest at the
  // outer edge, lighter near the fold) so it reads as a rounded surface rather than a
  // single flat tint. ----
  const SPINE_WIDTH = Math.max(10, Math.round(coverWidth * 0.07));
  const spineSvg = `<svg width="${SPINE_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="black" stop-opacity="0.7"/>
        <stop offset="70%" stop-color="black" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  const spine = await sharp(Buffer.from(spineSvg)).png().toBuffer();

  // Build the spine panel itself by stretching a thin slice of the cover's own left edge
  // to SPINE_WIDTH, then shading it with the gradient above — this keeps the spine's color
  // visually connected to the cover (same book "material") instead of a flat black bar,
  // and crucially keeps it fully opaque (a plain transparent gap here would show through
  // once sheared, and worse, would pick up stray color from the gloss layer below).
  const spineSourceSlice = await sharp(resizedCover)
    .extract({ left: 0, top: 0, width: Math.min(8, coverWidth), height: COVER_HEIGHT })
    .resize({ width: SPINE_WIDTH, height: COVER_HEIGHT, fit: "fill" })
    .toBuffer();
  const spinePanel = await sharp(spineSourceSlice)
    .composite([{ input: spine, left: 0, top: 0, blend: "multiply" }])
    .png()
    .toBuffer();

  // ---- Page edge: a thin cream/tan sliver along the right edge suggesting the block
  // of paper pages, with its own light-to-shadow gradient for a rounded look. ----
  const PAGE_WIDTH = Math.max(4, Math.round(coverWidth * 0.02));
  const pageSvg = `<svg width="${PAGE_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#b7ad93"/>
        <stop offset="45%" stop-color="#f1ecdd"/>
        <stop offset="100%" stop-color="#9c917a"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  const pageEdge = await sharp(Buffer.from(pageSvg)).png().toBuffer();

  // ---- Assemble spine + cover + page edge into one flat, fully opaque strip, then lay a
  // soft diagonal gloss highlight across the whole thing (as if catching studio light off
  // a laminated cover) before it all gets sheared together. ----
  const faceWidth = SPINE_WIDTH + coverWidth + PAGE_WIDTH;
  const glossSvg = `<svg width="${faceWidth}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="30%" stop-color="white" stop-opacity="0"/>
        <stop offset="46%" stop-color="white" stop-opacity="0.16"/>
        <stop offset="58%" stop-color="white" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  const gloss = await sharp(Buffer.from(glossSvg)).png().toBuffer();

  const bookFace = await sharp({
    create: { width: faceWidth, height: COVER_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: spinePanel, left: 0, top: 0 },
      { input: resizedCover, left: SPINE_WIDTH, top: 0 },
      { input: pageEdge, left: SPINE_WIDTH + coverWidth, top: 0 },
      { input: gloss, left: 0, top: 0, blend: "screen" },
    ])
    .png()
    .toBuffer();

  // Shear the whole book face a few degrees so it reads as tilted/standing rather than a
  // flat scan. sharp's affine transform auto-expands the canvas to fit the result.
  const SHEAR = 0.09;
  const sheared = await sharp(bookFace)
    .affine([1, 0, SHEAR, 1], { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const shearedMeta = await sharp(sheared).metadata();
  const shearedWidth = shearedMeta.width;
  const shearedHeight = shearedMeta.height;

  // Telegram's channel feed center-crops tall/portrait photos (see the comment on
  // paddedCoverUrl in telegram.js) — the safe fix used elsewhere in this app is to pad the
  // image onto a square (1:1) canvas instead of a tall rectangle. Beyond just avoiding the
  // crop, we deliberately leave the book some breathing room (it fills ~70% of the frame
  // height and ~60% of the width, at most) so the shelf/table scene behind it is actually
  // visible — a book stretched edge-to-edge would leave no room to look "photographed".
  const BOOK_HEIGHT_FRACTION = 0.7;
  const BOOK_WIDTH_FRACTION = 0.6;
  const BOOK_BOTTOM_FRACTION = 0.8; // leaves more room above (shelf) than below (table)

  const canvasSize = Math.round(Math.max(shearedHeight / BOOK_HEIGHT_FRACTION, shearedWidth / BOOK_WIDTH_FRACTION));
  const canvasWidth = canvasSize;
  const canvasHeight = canvasSize;
  const left = Math.round((canvasWidth - shearedWidth) / 2);
  const bottomOfImage = Math.round(canvasHeight * BOOK_BOTTOM_FRACTION);
  const top = bottomOfImage - shearedHeight;
  const horizonY = bottomOfImage;

  const background = await sharp(Buffer.from(buildSceneSvg(canvasWidth, canvasHeight, horizonY))).png().toBuffer();

  // Two-layer shadow: a tight, darker contact shadow right under the book, plus a
  // softer, larger cast shadow offset toward the lower-right (as if lit from the upper
  // left) — reads much more like a photographed object than one flat blurred ellipse.
  const shadowSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${canvasWidth / 2 + shearedWidth * 0.08}" cy="${horizonY + canvasHeight * 0.02}" rx="${shearedWidth * 0.62}" ry="${canvasHeight * 0.035}" fill="black" opacity="0.28"/>
    <ellipse cx="${canvasWidth / 2}" cy="${horizonY}" rx="${shearedWidth * 0.42}" ry="${canvasHeight * 0.014}" fill="black" opacity="0.4"/>
  </svg>`;
  const shadow = await sharp(Buffer.from(shadowSvg)).blur(canvasWidth * 0.02).png().toBuffer();

  const finalImage = await sharp(background)
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: sheared, left, top },
    ])
    .png()
    .toBuffer();

  return finalImage;
}

module.exports = { buildCoverMockup };
