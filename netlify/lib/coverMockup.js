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
function buildShelfSceneSvg(width, height, horizonY) {
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

// ---- Scene 2: marble table — a softly-lit, evenly-toned plaster wall behind a light
// marble surface with a handful of procedurally-drawn, randomly-curved veins. No shelf/
// book-spine texture here on purpose — the point of this scene is a calmer, more
// "product photography" look than the busy bookshelf.
const MARBLE_VEIN_COLORS = ["#9a958c", "#b5afa3", "#7d776c", "#c9c2b3"];

function buildMarbleSceneSvg(width, height, horizonY) {
  const veins = [];
  const veinCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < veinCount; i++) {
    const startX = Math.random() * width;
    const startY = horizonY + Math.random() * (height - horizonY) * 0.3;
    const cp1x = startX + (Math.random() - 0.5) * width * 0.5;
    const cp1y = startY + Math.random() * (height - horizonY) * 0.5;
    const cp2x = startX + (Math.random() - 0.5) * width * 0.7;
    const cp2y = height - Math.random() * (height - horizonY) * 0.2;
    const endX = startX + (Math.random() - 0.5) * width * 0.9;
    veins.push(
      `<path d="M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${height}" stroke="${pick(
        MARBLE_VEIN_COLORS
      )}" stroke-width="${1 + Math.random() * 2.5}" fill="none" opacity="${0.25 + Math.random() * 0.3}"/>`
    );
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e9e5dc"/>
        <stop offset="100%" stop-color="#d7d2c6"/>
      </linearGradient>
      <linearGradient id="marbleBase" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f2efe9"/>
        <stop offset="100%" stop-color="#dedad0"/>
      </linearGradient>
      <filter id="veinBlur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${Math.max(1, width * 0.0015)}"/>
      </filter>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
      </filter>
      <linearGradient id="horizonShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
        <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
      </radialGradient>
    </defs>

    <rect width="${width}" height="${horizonY}" fill="url(#wallGrad)"/>
    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" fill="url(#marbleBase)"/>
    <g filter="url(#veinBlur)">${veins.join("")}</g>
    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" filter="url(#grain)"/>
    <rect x="0" y="${horizonY - height * 0.05}" width="${width}" height="${height * 0.08}" fill="url(#horizonShade)"/>

    <rect width="${width}" height="${height}" fill="url(#vignette)"/>
  </svg>`;
}

// ---- Scene 3: reading corner — a warm, cozy backdrop: a terracotta wall, a heavily
// blurred houseplant silhouette tucked into one corner, and a soft warm bokeh circle
// standing in for window light. Table below is a plain warm wood tone (no veins/shelf
// texture) so it doesn't compete with the plant/light already doing the "mood" work.
const PLANT_GREENS = ["#2f4a35", "#3c5c40", "#26382a", "#4a6b4f"];

// A simple almond/leaf silhouette (two quadratic curves) rotated around (cx, cy) — cheap
// to generate in bulk and reads fine once heavily blurred.
function leafPath(cx, cy, size, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts = [
    [0, -size],
    [size * 0.6, 0],
    [0, size],
    [-size * 0.6, 0],
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
  return `M ${pts[0][0]} ${pts[0][1]} Q ${pts[1][0]} ${pts[1][1]} ${pts[2][0]} ${pts[2][1]} Q ${pts[3][0]} ${pts[3][1]} ${pts[0][0]} ${pts[0][1]} Z`;
}

function buildReadingCornerSceneSvg(width, height, horizonY) {
  const leaves = [];
  const leafCount = 5 + Math.floor(Math.random() * 4);
  const cornerX = Math.random() < 0.5 ? 0 : width; // plant sits in a random corner each time
  for (let i = 0; i < leafCount; i++) {
    const cx = cornerX + (Math.random() - 0.5) * width * 0.35;
    const cy = horizonY * (0.1 + Math.random() * 0.6);
    const size = width * (0.06 + Math.random() * 0.05);
    leaves.push(`<path d="${leafPath(cx, cy, size, Math.random() * 360)}" fill="${pick(PLANT_GREENS)}"/>`);
  }
  const bokehX = cornerX === 0 ? width * 0.8 : width * 0.2; // window light in the opposite corner

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6b4a3a"/>
        <stop offset="100%" stop-color="#4a3327"/>
      </linearGradient>
      <linearGradient id="woodGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5c4030"/>
        <stop offset="100%" stop-color="#3a281c"/>
      </linearGradient>
      <filter id="sceneBlur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${Math.round(width * 0.018)}"/>
      </filter>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"/>
      </filter>
      <radialGradient id="bokeh" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffdca0" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#ffdca0" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="horizonShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
        <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.3"/>
      </radialGradient>
    </defs>

    <rect width="${width}" height="${horizonY}" fill="url(#wallGrad)"/>
    <circle cx="${bokehX}" cy="${horizonY * 0.35}" r="${width * 0.22}" fill="url(#bokeh)"/>
    <g filter="url(#sceneBlur)">${leaves.join("")}</g>

    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" fill="url(#woodGrad)"/>
    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" filter="url(#grain)"/>
    <rect x="0" y="${horizonY - height * 0.06}" width="${width}" height="${height * 0.1}" fill="url(#horizonShade)"/>

    <rect width="${width}" height="${height}" fill="url(#vignette)"/>
  </svg>`;
}

// Every scene a mockup can be generated against, keyed by the id the frontend/API send.
// Exported so both the frontend's dropdown values and the Netlify function's validation
// stay backed by one single list instead of three hand-copied ones.
const SCENES = [
  { id: "shelf", name: "Bookshelf" },
  { id: "marble", name: "Marble table" },
  { id: "reading", name: "Reading corner" },
];
const SCENE_BUILDERS = {
  shelf: buildShelfSceneSvg,
  marble: buildMarbleSceneSvg,
  reading: buildReadingCornerSceneSvg,
};

function buildSceneSvg(scene, width, height, horizonY) {
  const builder = SCENE_BUILDERS[scene] || SCENE_BUILDERS.shelf; // unknown/missing id -> old default
  return builder(width, height, horizonY);
}

// Loads a cover into a Buffer regardless of whether it arrived as a manually-uploaded
// data: URI (base64) or an actual fetchable image URL.
async function loadCoverBuffer(coverUrl) {
  if (coverUrl.startsWith("data:")) {
    const base64 = coverUrl.split(",")[1] || "";
    return Buffer.from(base64, "base64");
  }
  const res = await fetch(coverUrl);
  if (!res.ok) throw new Error(`Failed to download cover (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Turns one flat cover image into a sheared, "standing book" layer: resizes to
// `targetHeight`, adds a darkened spine strip along the left edge, a thin page-edge
// sliver on the right, a soft diagonal gloss highlight, then shears the whole face a few
// degrees so it reads as tilted/standing rather than a flat scan. `targetHeight` lets a
// multi-book collection give each cover a slightly different height (like real books of
// different sizes standing side by side) while still sharing one shear angle/style.
// Returns the sheared PNG buffer plus its final (post-shear) width/height.
async function buildShearedBookLayer(coverBuffer, targetHeight) {
  const meta = await sharp(coverBuffer).rotate().metadata();
  const coverWidth = Math.round(((meta.width || 1) / (meta.height || 1)) * targetHeight);

  const resizedCover = await sharp(coverBuffer)
    .rotate() // respect EXIF orientation before we do any of our own transforms
    .resize({ height: targetHeight, width: coverWidth, fit: "fill" })
    .toBuffer();

  // ---- Spine: a darkened, gradient-shaded strip along the left edge (darkest at the
  // outer edge, lighter near the fold) so it reads as a rounded surface rather than a
  // single flat tint. ----
  const SPINE_WIDTH = Math.max(10, Math.round(coverWidth * 0.07));
  const spineSvg = `<svg width="${SPINE_WIDTH}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
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
    .extract({ left: 0, top: 0, width: Math.min(8, coverWidth), height: targetHeight })
    .resize({ width: SPINE_WIDTH, height: targetHeight, fit: "fill" })
    .toBuffer();
  const spinePanel = await sharp(spineSourceSlice)
    .composite([{ input: spine, left: 0, top: 0, blend: "multiply" }])
    .png()
    .toBuffer();

  // ---- Page edge: a thin cream/tan sliver along the right edge suggesting the block
  // of paper pages, with its own light-to-shadow gradient for a rounded look. ----
  const PAGE_WIDTH = Math.max(4, Math.round(coverWidth * 0.02));
  const pageSvg = `<svg width="${PAGE_WIDTH}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
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
  const glossSvg = `<svg width="${faceWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
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
    create: { width: faceWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
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
  // flat scan. sharp's affine transform auto-expands the canvas to fit the result. This is
  // a pure horizontal shear (the matrix's y-row is untouched), so the sheared height always
  // comes out equal to targetHeight — every book in a collection can therefore still be
  // bottom-aligned onto the same shelf/table line even when their target heights differ.
  const SHEAR = 0.09;
  const sheared = await sharp(bookFace)
    .affine([1, 0, SHEAR, 1], { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const shearedMeta = await sharp(sheared).metadata();
  return { sheared, shearedWidth: shearedMeta.width, shearedHeight: shearedMeta.height };
}

const MAX_COLLECTION_COVERS = 4;

// Builds a lightweight "book(s) on a shelf" mockup from one or more flat cover images: a
// slight shear on each to suggest it's standing at an angle, a darker spine strip, a thin
// page-edge sliver, a soft diagonal gloss highlight, a two-layer contact+cast shadow, and
// a procedurally-generated scene background behind them. Pass a single cover_url string
// for the original single-book mockup, or an array of 2+ cover_urls to render them as a
// standing group/collection (order left-to-right matches the array order). Everything is
// done with sharp/libvips + inline SVG locally — no external mockup service, no photo/
// template assets — so it works for any cover size or aspect ratio. Returns a PNG buffer
// ready to upload straight to Telegram.
async function buildCoverMockup(coverUrlOrUrls, scene = "shelf") {
  const urls = Array.isArray(coverUrlOrUrls) ? coverUrlOrUrls : [coverUrlOrUrls];
  if (!urls.length) throw new Error("No cover image provided.");
  if (urls.length > MAX_COLLECTION_COVERS) {
    throw new Error(`Too many covers for one mockup (max ${MAX_COLLECTION_COVERS}).`);
  }

  // Telegram's channel feed center-crops tall/portrait photos (see the comment on
  // paddedCoverUrl in telegram.js) — the safe fix used elsewhere in this app is to pad the
  // image onto a square (1:1) canvas instead of a tall rectangle.
  const BOOK_BOTTOM_FRACTION = 0.8; // leaves more room above (shelf) than below (table)

  if (urls.length === 1) {
    // ---- Single book: unchanged from the original layout/proportions. ----
    const coverBuffer = await loadCoverBuffer(urls[0]);
    const { sheared, shearedWidth, shearedHeight } = await buildShearedBookLayer(coverBuffer, COVER_HEIGHT);

    // Deliberately leave the book some breathing room (it fills ~70% of the frame height
    // and ~60% of the width, at most) so the shelf/table scene behind it is actually
    // visible — a book stretched edge-to-edge would leave no room to look "photographed".
    const BOOK_HEIGHT_FRACTION = 0.7;
    const BOOK_WIDTH_FRACTION = 0.6;

    const canvasSize = Math.round(Math.max(shearedHeight / BOOK_HEIGHT_FRACTION, shearedWidth / BOOK_WIDTH_FRACTION));
    const canvasWidth = canvasSize;
    const canvasHeight = canvasSize;
    const left = Math.round((canvasWidth - shearedWidth) / 2);
    const bottomOfImage = Math.round(canvasHeight * BOOK_BOTTOM_FRACTION);
    const top = bottomOfImage - shearedHeight;
    const horizonY = bottomOfImage;

    const background = await sharp(Buffer.from(buildSceneSvg(scene, canvasWidth, canvasHeight, horizonY)))
      .png()
      .toBuffer();

    // Two-layer shadow: a tight, darker contact shadow right under the book, plus a
    // softer, larger cast shadow offset toward the lower-right (as if lit from the upper
    // left) — reads much more like a photographed object than one flat blurred ellipse.
    const shadowSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${canvasWidth / 2 + shearedWidth * 0.08}" cy="${horizonY + canvasHeight * 0.02}" rx="${shearedWidth * 0.62}" ry="${canvasHeight * 0.035}" fill="black" opacity="0.28"/>
      <ellipse cx="${canvasWidth / 2}" cy="${horizonY}" rx="${shearedWidth * 0.42}" ry="${canvasHeight * 0.014}" fill="black" opacity="0.4"/>
    </svg>`;
    const shadow = await sharp(Buffer.from(shadowSvg)).blur(canvasWidth * 0.02).png().toBuffer();

    return sharp(background)
      .composite([
        { input: shadow, left: 0, top: 0 },
        { input: sheared, left, top },
      ])
      .png()
      .toBuffer();
  }

  // ---- Collection: 2+ books standing side by side, left-to-right in the given order. ----
  const buffers = await Promise.all(urls.map(loadCoverBuffer));
  // A mild random height variance per book (like real books of slightly different sizes
  // standing together) — all still share one shear angle/style from buildShearedBookLayer.
  const layers = await Promise.all(
    buffers.map((buf) => buildShearedBookLayer(buf, Math.round(COVER_HEIGHT * (0.92 + Math.random() * 0.08))))
  );

  const GROUP_HEIGHT_FRACTION = 0.66; // a touch less than the single-book case — a wider
  const GROUP_WIDTH_FRACTION = 0.84; // group needs more headroom on both axes
  const GAP_FRACTION = 0.05; // gap between adjacent books, relative to their average width

  const avgWidth = layers.reduce((sum, l) => sum + l.shearedWidth, 0) / layers.length;
  const gap = Math.round(avgWidth * GAP_FRACTION);
  const totalGroupWidth = layers.reduce((sum, l) => sum + l.shearedWidth, 0) + gap * (layers.length - 1);
  const maxShearedHeight = Math.max(...layers.map((l) => l.shearedHeight));

  const canvasSize = Math.round(
    Math.max(maxShearedHeight / GROUP_HEIGHT_FRACTION, totalGroupWidth / GROUP_WIDTH_FRACTION)
  );
  const canvasWidth = canvasSize;
  const canvasHeight = canvasSize;
  const bottomOfImage = Math.round(canvasHeight * BOOK_BOTTOM_FRACTION);
  const horizonY = bottomOfImage;
  const startLeft = Math.round((canvasWidth - totalGroupWidth) / 2);

  const positions = [];
  let cursor = startLeft;
  for (const layer of layers) {
    positions.push({ left: cursor, top: bottomOfImage - layer.shearedHeight });
    cursor += layer.shearedWidth + gap;
  }

  const background = await sharp(Buffer.from(buildSceneSvg(scene, canvasWidth, canvasHeight, horizonY)))
    .png()
    .toBuffer();

  // One shadow layer for the whole group: a soft ambient ellipse spanning the group's full
  // footprint for cohesion, plus a tight contact ellipse under each individual book so
  // gaps between books still read as each one touching the surface.
  const perBookContactShadows = layers
    .map(
      (layer, i) =>
        `<ellipse cx="${positions[i].left + layer.shearedWidth / 2}" cy="${horizonY}" rx="${layer.shearedWidth * 0.46}" ry="${canvasHeight * 0.014}" fill="black" opacity="0.4"/>`
    )
    .join("");
  const shadowSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${canvasWidth / 2 + totalGroupWidth * 0.04}" cy="${horizonY + canvasHeight * 0.02}" rx="${totalGroupWidth * 0.56}" ry="${canvasHeight * 0.035}" fill="black" opacity="0.28"/>
    ${perBookContactShadows}
  </svg>`;
  const shadow = await sharp(Buffer.from(shadowSvg)).blur(canvasWidth * 0.02).png().toBuffer();

  return sharp(background)
    .composite([
      { input: shadow, left: 0, top: 0 },
      ...layers.map((layer, i) => ({ input: layer.sheared, left: positions[i].left, top: positions[i].top })),
    ])
    .png()
    .toBuffer();
}

module.exports = { buildCoverMockup, SCENES, MAX_COLLECTION_COVERS };
