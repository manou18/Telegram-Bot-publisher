// Uses Google's Gemini API to read a manually-added book's cover image and/or book file
// (PDF natively, EPUB via a locally-extracted text sample — see epubMeta.js) and propose a
// title, author, and description for the "Add Manually" form's Extract-with-AI button.
//
// Kept deliberately conservative:
//   - Only ever *suggests* values back to the form fields — nothing is auto-published.
//   - The description is asked for in the language of the book itself, sized to fit
//     Telegram's real caption limit (see the maxDescriptionLength param, which the caller
//     derives the same way netlify/lib/telegram.js does: shorter when a cover photo will
//     also be sent as the caption, since Telegram's photo-caption limit is smaller than a
//     plain text message's).
//   - Whatever Gemini returns is still hard-truncated locally afterwards, so a model that
//     ignores the length instruction can't produce something Telegram would reject.

const { readEpubMetadata } = require("./epubMeta");
const { callGemini, truncate, DEFAULT_MODEL } = require("./geminiClient");

const MAX_INLINE_FILE_BYTES = 15 * 1024 * 1024; // stay under Gemini's ~20MB inline request cap
const MAX_EPUB_SAMPLE_CHARS = 12000;

async function fetchAsBuffer(url, maxBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url} (HTTP ${r.status}).`);
  const contentLength = Number(r.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) {
    throw new Error(`File at ${url} is too large (${(contentLength / 1024 / 1024).toFixed(1)} MB) to send to Gemini directly.`);
  }
  const arrayBuffer = await r.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > maxBytes) {
    throw new Error(`File at ${url} is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB) to send to Gemini directly.`);
  }
  return buffer;
}

// Resolves a `data:` URI or a plain URL into { buffer, mimeType, tooLarge }. `buffer` is null
// (rather than throwing) for values that are missing, unreadable, or too large, so the caller
// can gracefully fall back to whatever other inputs it does have (e.g. still use the cover if
// the book file is huge). `tooLarge` specifically flags the "too large to send inline" case so
// the caller can tell it apart from other read failures and adjust the prompt accordingly.
async function resolveToBuffer(value, { maxBytes, fallbackMime, warnings, label }) {
  if (!value) return { buffer: null, tooLarge: false };
  try {
    if (value.startsWith("data:")) {
      const match = value.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) return { buffer: null, tooLarge: false };
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > maxBytes) {
        warnings.push(`${label} is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB) to send to Gemini — skipped.`);
        return { buffer: null, tooLarge: true };
      }
      return { buffer, mimeType: match[1] || fallbackMime, tooLarge: false };
    }
    const buffer = await fetchAsBuffer(value, maxBytes);
    return { buffer, mimeType: fallbackMime, tooLarge: false };
  } catch (e) {
    const tooLarge = /too large/i.test(e.message);
    warnings.push(`Could not read ${label} (${e.message}) — skipped.`);
    return { buffer: null, tooLarge };
  }
}

// `descriptionFromCoverOnly`: true when the book file was too large to send inline and we're
// relying solely on the cover image. In that case we don't ask Gemini to describe the book from
// the cover art (a cover rarely shows more than the title/author) — we ask it to identify the
// title/author from the cover and then draw on its own general knowledge of that specific book to
// write the description, without ever seeing the file's actual contents.
function buildPrompt(maxDescriptionLength, { descriptionFromCoverOnly = false } = {}) {
  const intro = "You are helping prepare a free/public-domain book for posting to a Telegram channel.";

  if (descriptionFromCoverOnly) {
    return `${intro}

The book file itself was too large to send along with this request, so you are only given its cover image below.

- "title": the book's title, in its original language/script as printed on the cover.
- "author": the author's/authors' name(s). Use "Unknown" if it genuinely cannot be determined from the cover.
- "description": do NOT try to infer this from the cover artwork alone. Instead, using your own general knowledge of this specific book (identified by the title and author you read off the cover), write a short, accurate back-cover-style description of what it is about, in the SAME language as the book itself. If you do not recognize this exact book well enough to describe it accurately, return an empty string "" for "description" rather than guessing or inventing a summary. It must be plain text (no markdown, no emojis, no hashtags) and MUST NOT exceed ${maxDescriptionLength} characters, including spaces — this is a hard limit imposed by Telegram, so stay comfortably under it rather than right at it.

If you cannot confidently determine "title" or "author", return an empty string "" for that field rather than guessing. Respond with JSON only, matching the schema.`;
  }

  return `${intro}

Using ONLY the material provided (the book's cover image and/or the book file/text below), determine:
- "title": the book's title, in its original language/script as printed on the cover or title page.
- "author": the author's/authors' name(s). Use "Unknown" if it genuinely cannot be determined.
- "description": a short, accurate back-cover-style description of what the book is about, written in the SAME language as the book itself. It must be plain text (no markdown, no emojis, no hashtags) and MUST NOT exceed ${maxDescriptionLength} characters, including spaces — this is a hard limit imposed by Telegram, so stay comfortably under it rather than right at it.

If you cannot confidently determine a field from the provided material, return an empty string "" for it rather than guessing. Respond with JSON only, matching the schema.`;
}

const EXTRACT_SCHEMA = {
  title: { type: "STRING" },
  author: { type: "STRING" },
  description: { type: "STRING" },
};
const EXTRACT_REQUIRED = ["title", "author", "description"];

// coverUrl / fileUrl: each either a `data:...;base64,...` URI (as produced by the manual
// form's file inputs) or a plain fetchable URL (as pasted into the "…or paste a URL" fields).
// fileType: "pdf" | "epub" | null/undefined.
// maxDescriptionLength: caller-supplied cap (see comment at top of file).
async function extractBookInfo({ coverUrl, fileUrl, fileType, maxDescriptionLength = 500, model }) {
  const warnings = [];
  const parts = [];

  const cover = await resolveToBuffer(coverUrl, {
    maxBytes: MAX_INLINE_FILE_BYTES,
    fallbackMime: "image/jpeg",
    warnings,
    label: "the cover image",
  });
  if (cover.buffer) {
    parts.push({ inlineData: { mimeType: cover.mimeType, data: cover.buffer.toString("base64") } });
  }

  // Tracks whether the book file was dropped specifically because it was too big to send
  // inline (as opposed to not being provided at all, or some other read failure).
  let fileSkippedForSize = false;

  if (fileUrl && fileType === "epub") {
    const epubRes = await resolveToBuffer(fileUrl, {
      maxBytes: MAX_INLINE_FILE_BYTES,
      fallbackMime: "application/epub+zip",
      warnings,
      label: "the EPUB file",
    });
    fileSkippedForSize = epubRes.tooLarge;
    if (epubRes.buffer) {
      try {
        const meta = readEpubMetadata(epubRes.buffer, { maxSampleChars: MAX_EPUB_SAMPLE_CHARS });
        const metaText = [
          meta.title ? `EPUB metadata title: ${meta.title}` : "",
          meta.author ? `EPUB metadata author: ${meta.author}` : "",
          meta.description ? `EPUB metadata description: ${meta.description}` : "",
          meta.sampleText ? `\nExcerpt from the book's opening chapters:\n${meta.sampleText}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        if (metaText) parts.push({ text: metaText });
      } catch (e) {
        warnings.push(`Could not read the EPUB's contents (${e.message}) — falling back to the cover image only.`);
      }
    }
  } else if (fileUrl && fileType === "pdf") {
    const pdfRes = await resolveToBuffer(fileUrl, {
      maxBytes: MAX_INLINE_FILE_BYTES,
      fallbackMime: "application/pdf",
      warnings,
      label: "the PDF file",
    });
    fileSkippedForSize = pdfRes.tooLarge;
    if (pdfRes.buffer) {
      parts.push({ inlineData: { mimeType: "application/pdf", data: pdfRes.buffer.toString("base64") } });
    }
  }

  if (parts.length === 0) {
    throw new Error("No usable cover image or book file could be read to send to Gemini.");
  }

  // Only switch to the "describe from title/author" prompt when the file was skipped purely
  // for being too large AND we still have the cover to identify the book from — otherwise use
  // the normal prompt (e.g. a small file was sent fine, or there's no file at all to skip).
  const descriptionFromCoverOnly = fileSkippedForSize && !!cover.buffer;
  const promptText = buildPrompt(maxDescriptionLength, { descriptionFromCoverOnly });
  const result = await callGemini({
    promptText,
    parts,
    model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    schema: EXTRACT_SCHEMA,
    required: EXTRACT_REQUIRED,
  });

  return {
    title: truncate(result.title || "", 300),
    author: truncate(result.author || "", 200),
    description: truncate(result.description || "", maxDescriptionLength),
    warnings,
  };
}

module.exports = { extractBookInfo };
