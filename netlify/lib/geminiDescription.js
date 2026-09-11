// Uses Gemini to rewrite a book's description into something short, accurate, and sized
// to actually fit Telegram's real limits — for the "🪄 Rewrite with AI" button in the
// preview panel (books pulled from archive.org / Open Library / Google Books / OAPEN /
// DOAB, whose raw descriptions are often long, off-topic boilerplate, or in the wrong
// language, and which netlify/lib/telegram.js's truncate() would otherwise just chop off
// mid-sentence at 500/1500 characters).
//
// Text-only: unlike geminiExtract.js this never needs the cover image or the book file —
// the title, author, and (if any) existing raw description are enough context, which
// keeps this fast and cheap enough to call on demand from the preview screen.

const { callGemini, truncate, DEFAULT_MODEL } = require("./geminiClient");

const DESCRIPTION_SCHEMA = { description: { type: "STRING" } };
const DESCRIPTION_REQUIRED = ["description"];

function buildPrompt({ title, author, description, maxDescriptionLength }) {
  const intro = "You are helping prepare a free/public-domain book for posting to a Telegram channel.";
  const identity = `Title: ${title || "(unknown)"}\nAuthor: ${author || "(unknown)"}`;

  if (description && description.trim()) {
    return `${intro}

Below is the book's identity and its current description, which was pulled automatically from a library/archive source. It may be too long, generic, off-topic (e.g. cataloguing/licensing boilerplate), or in a different language than the book itself.

${identity}

Current description:
"""
${description.trim()}
"""

Rewrite it as a short, accurate, back-cover-style description of what the book is actually about, written in the SAME language as the book itself (not necessarily the language of the current description above, if that differs). Plain text only (no markdown, no emojis, no hashtags). It MUST NOT exceed ${maxDescriptionLength} characters, including spaces — this is a hard limit imposed by Telegram, so stay comfortably under it rather than right at it, and never cut a sentence off mid-way: end on a complete sentence.

Respond with JSON only, matching the schema.`;
  }

  return `${intro}

No description is available for this book — only its identity:

${identity}

Using your own general knowledge of this specific book, write a short, accurate, back-cover-style description of what it is about, in the SAME language as the book itself. Plain text only (no markdown, no emojis, no hashtags). It MUST NOT exceed ${maxDescriptionLength} characters, including spaces — this is a hard limit imposed by Telegram, so stay comfortably under it rather than right at it, and never cut a sentence off mid-way: end on a complete sentence.

If you do not recognize this exact book (by this title and author) well enough to describe it accurately, return an empty string "" rather than guessing or inventing a summary. Respond with JSON only, matching the schema.`;
}

// title/author: the book's known identity (always available — buildBook always sets these).
// description: the current raw description, if any (empty/missing triggers the
// knowledge-based fallback prompt above).
// maxDescriptionLength: caller-supplied cap — same 500 (with cover) / 1500 (without) logic
// used by netlify/lib/telegram.js and geminiExtract.js, so the result always fits whichever
// Telegram limit will actually apply once published.
async function generateDescription({ title, author, description, maxDescriptionLength = 500, model }) {
  const promptText = buildPrompt({ title, author, description, maxDescriptionLength });
  const result = await callGemini({
    promptText,
    parts: [],
    model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    schema: DESCRIPTION_SCHEMA,
    required: DESCRIPTION_REQUIRED,
  });

  return {
    description: truncate(result.description || "", maxDescriptionLength),
  };
}

module.exports = { generateDescription };
