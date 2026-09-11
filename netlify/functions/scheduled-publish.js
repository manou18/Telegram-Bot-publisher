// Runs on a timer (configured in netlify.toml, not called by the frontend) and publishes
// any scheduled book whose target time has arrived. Netlify invokes this on its own —
// there's no X-Site-Password header to check here, which is fine: it only ever acts on
// books an authenticated user already scheduled through /api/schedule, it never accepts
// arbitrary input from the request itself.

const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");
const { recordPublished } = require("../lib/publishLog");
const { unsaveBook } = require("../lib/savedBooks");
const { getDuePending, markScheduledResult } = require("../lib/scheduledBooks");

const DELAY_BETWEEN_MS = 2000; // spread posts out a bit, same reasoning as the bulk-publish UI

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  try {
    const due = await getDuePending(event, new Date().toISOString());
    const results = [];

    for (const record of due) {
      try {
        const source = SOURCES[record.sourceId];
        if (!source) throw new Error(`Unknown source ${record.sourceId}`);

        const book = await source.buildBook(record.item);
        book.rating = record.rating;
        book.category = record.category || null;
        // Carry forward any description the user edited/rewrote with AI at schedule time,
        // instead of publishing the raw source description that buildBook() just fetched.
        if (typeof record.description === "string") {
          book.description = record.description.trim() || null;
        }

        if (record.fileType === "pdf" && book.download_url_pdf) {
          book.download_url = book.download_url_pdf;
        } else if (record.fileType === "epub" && book.download_url_epub) {
          book.download_url = book.download_url_epub;
        }

        const sendResult = await sendBook(book, !!record.publishCoverOnlyIfNoFile);

        try {
          await recordPublished(event, record.sourceId, record.item, book);
        } catch (e) {
          console.error("Failed to record scheduled publish in the publish log:", e.message);
        }
        try {
          await unsaveBook(event, record.sourceId, record.item);
        } catch (e) {
          // harmless if it was never saved
        }

        await markScheduledResult(event, record.id, "published", sendResult.message || "Published.");
        results.push({ id: record.id, status: "published" });
      } catch (e) {
        console.error(`Scheduled publish failed for ${record.id} (${record.title}):`, e.message);
        await markScheduledResult(event, record.id, "failed", e.message);
        results.push({ id: record.id, status: "failed", error: e.message });
      }

      await sleep(DELAY_BETWEEN_MS);
    }

    return { statusCode: 200, body: JSON.stringify({ processed: results.length, results }) };
  } catch (e) {
    console.error("scheduled-publish run failed:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
