// Small shared layer around Gemini's generateContent endpoint, used by both
// geminiExtract.js (the "Add Manually" extract-with-AI feature) and geminiDescription.js
// (the "rewrite description with AI" feature). Kept in one place so the API key handling,
// timeout, and response-schema plumbing don't drift between the two.

// gemini-2.0-flash was fully retired by Google (calls now fail outright rather than just
// being deprecated-with-a-warning). gemini-3.5-flash-lite is the current cheapest/fastest
// GA model and defaults to minimal "thinking" — plenty for this app's structured
// extraction/description-rewrite tasks, which don't need heavy reasoning. Override via the
// GEMINI_MODEL env var (e.g. to gemini-3.6-flash) if a specific deployment wants more.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = 25000; // Netlify functions have their own hard timeout; fail before that

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set as an environment variable in Netlify.");
  }
  return key;
}

function truncate(text, max) {
  if (!text) return "";
  const trimmed = String(text).trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

// `schema`/`required` describe the JSON object Gemini should return (see responseSchema
// below) — callers pass whichever shape they need (title/author/description, or just
// description) rather than this module hard-coding one shape for every caller.
async function callGemini({ promptText, parts, model, schema, required }) {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }, ...parts] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: schema, required },
          temperature: 0.4,
        },
      }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const message = (data && data.error && data.error.message) || `Gemini request failed (HTTP ${r.status}).`;
      throw new Error(message);
    }

    const candidate = data && data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts.map((p) => p.text || "").join("");
    if (!text) {
      const reason = candidate && candidate.finishReason;
      throw new Error(reason ? `Gemini returned no usable content (finishReason: ${reason}).` : "Gemini returned an empty response.");
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Gemini's response wasn't valid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callGemini, truncate, getApiKey, DEFAULT_MODEL, GEMINI_TIMEOUT_MS };
