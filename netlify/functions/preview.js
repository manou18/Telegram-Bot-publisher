const { SOURCES } = require("../lib/sources");
const { checkPublished } = require("../lib/publishLog");
const { getRemoteFileSize } = require("../lib/fileSize");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }
    const { source: sourceId, item } = JSON.parse(event.body || "{}");
    const source = SOURCES[sourceId];
    if (!source || !item) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

    const book = await source.buildBook(item);

    // Look up sizes for whichever formats are available so the UI can show them before
    // publishing. Done in parallel and best-effort — a host that won't answer stays null
    // and the frontend just shows "size unknown" instead of failing the whole preview.
    const [sizePdf, sizeEpub] = await Promise.all([
      getRemoteFileSize(book.download_url_pdf),
      getRemoteFileSize(book.download_url_epub),
    ]);
    book.file_size_pdf = sizePdf;
    book.file_size_epub = sizeEpub;

    let alreadyPublished = null;
    try {
      alreadyPublished = await checkPublished(event, book);
    } catch (e) {
      console.error("Failed to check the publish log:", e.message);
    }
    book.already_published = !!alreadyPublished;
    book.published_at = alreadyPublished ? alreadyPublished.publishedAt : null;

    return { statusCode: 200, body: JSON.stringify(book) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
