const { extractBookInfo } = require("../lib/geminiExtract");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { cover_url: coverUrl, file_url: fileUrl, file_type: fileType, has_cover: hasCover } = JSON.parse(event.body || "{}");

    if (!coverUrl && !fileUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: "Add a cover image or a book file first, then extract." }) };
    }

    // Mirrors netlify/lib/telegram.js's own maxDescLen logic: Telegram's photo-caption
    // limit (1024 chars) is smaller than a plain text message's (4096), and the cover +
    // caption is what actually gets published together, so ask Gemini for a description
    // that will comfortably fit whichever one this book will end up using.
    const willHaveCover = hasCover !== undefined ? !!hasCover : !!coverUrl;
    const maxDescriptionLength = willHaveCover ? 500 : 1500;

    const result = await extractBookInfo({ coverUrl, fileUrl, fileType, maxDescriptionLength });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
