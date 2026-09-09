const sharp = require("sharp");

// Builds a lightweight "book on a shelf" mockup from a flat cover image: a slight
// shear to suggest the cover is standing at an angle, a darker spine strip along
// the left edge, and a soft blurred shadow underneath. Everything is done with
// sharp/libvips locally — no external mockup service, no template files — so it
// works for any cover size or aspect ratio. Returns a PNG buffer ready to upload
// straight to Telegram.
async function buildCoverMockup(coverUrl) {
  const res = await fetch(coverUrl);
  if (!res.ok) throw new Error(`Failed to download cover (HTTP ${res.status})`);
  const coverBuffer = Buffer.from(await res.arrayBuffer());

  const COVER_HEIGHT = 800;
  const meta = await sharp(coverBuffer).rotate().metadata();
  const coverWidth = Math.round(((meta.width || 1) / (meta.height || 1)) * COVER_HEIGHT);

  const resizedCover = await sharp(coverBuffer)
    .rotate() // respect EXIF orientation before we do any of our own transforms
    .resize({ height: COVER_HEIGHT, width: coverWidth, fit: "fill" })
    .toBuffer();

  // A darker strip along the left edge to read as the book's spine, multiplied
  // over the cover so it darkens the existing artwork instead of masking it.
  const SPINE_WIDTH = Math.max(8, Math.round(coverWidth * 0.06));
  const spine = await sharp({
    create: {
      width: SPINE_WIDTH,
      height: COVER_HEIGHT,
      channels: 4,
      background: { r: 15, g: 15, b: 15, alpha: 0.55 },
    },
  })
    .png()
    .toBuffer();

  const coverWithSpine = await sharp(resizedCover)
    .composite([{ input: spine, left: 0, top: 0, blend: "multiply" }])
    .png()
    .toBuffer();

  // Shear the cover a few degrees so it reads as tilted/standing rather than a
  // flat scan. sharp's affine transform auto-expands the canvas to fit the result.
  const SHEAR = 0.09;
  const sheared = await sharp(coverWithSpine)
    .affine([1, 0, SHEAR, 1], { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const shearedMeta = await sharp(sheared).metadata();
  const shearedWidth = shearedMeta.width;
  const shearedHeight = shearedMeta.height;

  // Telegram's channel feed center-crops tall/portrait photos (see the comment on
  // paddedCoverUrl in telegram.js) — the safe fix used elsewhere in this app is to
  // pad the image onto a square (1:1) canvas instead of a tall rectangle. We do the
  // same here: pick a small margin, then size the canvas to a square based on the
  // sheared cover's larger dimension, and center the cover inside it. For a portrait
  // cover this naturally adds extra whitespace on the sides (not just top/bottom),
  // which both avoids the crop and gives the smaller, more "framed" look.
  const MARGIN = Math.round(COVER_HEIGHT * 0.08);
  const squareSize = Math.max(shearedWidth, shearedHeight) + MARGIN * 2;
  const canvasWidth = squareSize;
  const canvasHeight = squareSize;
  const left = Math.round((canvasWidth - shearedWidth) / 2);
  const top = Math.round((canvasHeight - shearedHeight) / 2);
  const bottomOfImage = top + shearedHeight;

  // Soft blurred shadow sitting just under where the cover lands on the canvas.
  const shadowSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${canvasWidth / 2}" cy="${bottomOfImage + MARGIN * 0.4}" rx="${shearedWidth / 2.1}" ry="16" fill="black" opacity="0.35" />
  </svg>`;
  const shadow = await sharp(Buffer.from(shadowSvg)).blur(14).png().toBuffer();

  const finalImage = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: sheared, left, top },
    ])
    .png()
    .toBuffer();

  return finalImage;
}

module.exports = { buildCoverMockup };
