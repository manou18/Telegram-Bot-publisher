const { sendBook } = require("../lib/telegram");
const { checkPublished, recordPublished } = require("../lib/publishLog");
const { requireAuth } = require("../lib/auth");

// Pseudo source id for manually entered books — doesn't exist in lib/sources.js's SOURCES
// registry (there's no browsing/searching for these), but reuses the same publish log /
// duplicate-check machinery as every other source. See bookIdentity.js for how its dedupe
// key is derived (title+author, since the item here can carry large base64 blobs).
const MANUAL_SOURCE_ID = "manual";

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const {
      title,
      author,
      description,
      cover_url: coverUrl,
      download_url: downloadUrl,
      fileType,
      publishCoverOnlyIfNoFile,
      force,
    } = JSON.parse(event.body || "{}");

    if (!title || !title.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Title is required." }) };
    }
    if (!coverUrl && !downloadUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: "Add at least a cover or a book file." }) };
    }

    const book = {
      title: title.trim(),
      author: (author && author.trim()) || "Unknown",
      description: description && description.trim() ? description.trim() : null,
      cover_url: coverUrl || null,
      download_url: downloadUrl || null,
      download_url_pdf: downloadUrl && fileType !== "epub" ? downloadUrl : null,
      download_url_epub: downloadUrl && fileType === "epub" ? downloadUrl : null,
      source: "Manual Entry",
      rating: null,
      category: null,
    };

    // Only title+author go into the dedupe key — not the (possibly large) cover/file data.
    const keyItem = { title: book.title, author: book.author };

    if (!force) {
      let alreadyPublished = null;
      try {
        alreadyPublished = await checkPublished(event, MANUAL_SOURCE_ID, keyItem);
      } catch (e) {
        console.error("Failed to check the publish log:", e.message);
      }
      if (alreadyPublished) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            book,
            status: "duplicate",
            already_published: true,
            published_at: alreadyPublished.publishedAt,
            message: `⚠️ A book with this title/author was already published. Click Publish again to confirm if you want to republish it.`,
          }),
        };
      }
    }

    const result = await sendBook(book, !!publishCoverOnlyIfNoFile);

    try {
      await recordPublished(event, MANUAL_SOURCE_ID, keyItem, book);
    } catch (e) {
      console.error("Failed to record the book in the publish log:", e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ book, ...result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
