const { generateDescription } = require("../lib/geminiDescription");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { title, author, description, has_cover: hasCover } = JSON.parse(event.body || "{}");
    if (!title && !author) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing book title/author." }) };
    }

    // Mirrors netlify/lib/telegram.js's own maxDescLen logic (and extract-book-info.js's):
    // Telegram's photo-caption limit (1024 chars) is smaller than a plain text message's
    // (4096), and the cover + caption is what actually gets published together, so ask
    // Gemini for a description that will comfortably fit whichever one this book will use.
    const maxDescriptionLength = hasCover ? 500 : 1500;

    const result = await generateDescription({ title, author, description, maxDescriptionLength });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
