// Actually publishes one publish-queue record: builds the book from its source, sends it
// to Telegram, records it in the publish log, unsaves it if it was saved, and removes it
// from the queue on success. Factored out of scheduled-publish.js so the cron's drip-feed
// tick and the "🚀 Publish now" button (queue-publish-now.js) — which bypasses the
// interval to publish one specific item on demand — share the exact same publish path
// instead of two copies that could quietly drift apart.
//
// Throws on failure (network error, bad file, Telegram rejection...) and leaves the
// record untouched in the queue — the caller decides what to do with that (the cron marks
// an attempt via markQueueAttemptFailed(); a caller may choose differently).

const { SOURCES } = require("./sources");
const { sendBook } = require("./telegram");
const { recordPublished } = require("./publishLog");
const { unsaveBook } = require("./savedBooks");
const { removeFromQueue } = require("./publishQueue");
const { buildManualBook, MANUAL_SOURCE_ID } = require("./manualSource");

async function publishQueueRecord(event, record) {
  const source = SOURCES[record.sourceId];
  if (!source && record.sourceId !== MANUAL_SOURCE_ID) throw new Error(`Unknown source ${record.sourceId}`);

  const book = record.sourceId === MANUAL_SOURCE_ID ? buildManualBook(record.item) : await source.buildBook(record.item);
  book.rating = record.rating;
  book.category = record.category || null;
  if (record.cover_is_custom && record.cover_url) {
    book.cover_url = record.cover_url;
  }
  if (typeof record.description === "string") {
    book.description = record.description.trim() || null;
  }
  if (record.fileType === "pdf" && book.download_url_pdf) {
    book.download_url = book.download_url_pdf;
  } else if (record.fileType === "epub" && book.download_url_epub) {
    book.download_url = book.download_url_epub;
  }

  const sendResult = await sendBook(book, !!record.publishCoverOnlyIfNoFile, record.channels);

  try {
    await recordPublished(event, record.sourceId, record.item, book, sendResult.posts);
  } catch (e) {
    console.error("Failed to record queue publish in the publish log:", e.message);
  }
  try {
    await unsaveBook(event, record.sourceId, record.item);
  } catch (e) {
    // harmless if it was never saved
  }

  await removeFromQueue(event, record.id);
  return sendResult;
}

module.exports = { publishQueueRecord };
