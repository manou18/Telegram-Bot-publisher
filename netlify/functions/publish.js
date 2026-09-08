const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");
const { checkPublished, recordPublished } = require("../lib/publishLog");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item, publishCoverOnlyIfNoFile, force, fileType } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    const book = await source.buildBook(item);

    // If the book is available in both formats (PDF and EPUB) and the user specified
    // which one to publish from the UI, we swap download_url to the requested format before sending.
    if (fileType === "pdf" && book.download_url_pdf) {
      book.download_url = book.download_url_pdf;
    } else if (fileType === "epub" && book.download_url_epub) {
      book.download_url = book.download_url_epub;
    }

    // Duplicate check — protects even if this endpoint is called directly without going through
    // the UI, unless force:true is sent (after the user sees the warning and confirms publishing).
    if (!force) {
      let alreadyPublished = null;
      try {
        alreadyPublished = await checkPublished(event, book);
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
            message: `⚠️ This book was already published. Click Publish again to confirm if you want to republish it.`,
          }),
        };
      }
    }

    const result = await sendBook(book, !!publishCoverOnlyIfNoFile);

    try {
      await recordPublished(event, book);
    } catch (e) {
      console.error("Failed to record the book in the publish log:", e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ book, ...result }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
