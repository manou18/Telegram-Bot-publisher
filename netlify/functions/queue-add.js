const { SOURCES } = require("../lib/sources");
const { addToQueue, checkQueued } = require("../lib/publishQueue");
const { checkPublished } = require("../lib/publishLog");
const { checkScheduled } = require("../lib/scheduledBooks");
const { checkCopyrightStatus } = require("../lib/copyrightCheck");
const { requireAuth } = require("../lib/auth");
const { buildManualBook, MANUAL_SOURCE_ID } = require("../lib/manualSource");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    // Accepts either one book ({ source, item, ... }) or several at once
    // ({ items: [{ source, item, ... }, ...] }) — the "Add Selected to Queue" bulk action
    // (Saved Books tab) sends the whole batch in a single request instead of one round
    // trip per book. `force: true` (per item, or on the top-level body to apply to the
    // whole batch) skips the duplicate checks below and queues it anyway.
    const body = JSON.parse(event.body || "{}");
    const inputs = Array.isArray(body.items) ? body.items : [body];
    if (!inputs.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Nothing to queue." }) };
    }

    const added = [];
    const skipped = [];
    const failed = [];
    for (const input of inputs) {
      const { source: sourceId, item, fileType, publishCoverOnlyIfNoFile, category, customDescription, customCoverUrl, channels } = input || {};
      const force = !!(input && input.force) || !!body.force;
      const title = (item && item.title) || "?";
      try {
        // Duplicate check — mirrors the one /api/publish and /api/schedule already do,
        // so a book already published, already one-off scheduled, or already sitting in
        // the queue doesn't silently get a second (redundant, or worse — re-published)
        // copy queued up, unless the caller explicitly confirms with force:true.
        if (!force) {
          const [alreadyPublished, alreadyScheduled, alreadyQueued] = await Promise.all([
            checkPublished(event, sourceId, item).catch(() => null),
            checkScheduled(event, sourceId, item).catch(() => []),
            checkQueued(event, sourceId, item).catch(() => []),
          ]);
          if (alreadyPublished) {
            skipped.push({ title, reason: "already_published" });
            continue;
          }
          if (alreadyScheduled && alreadyScheduled.length) {
            skipped.push({ title, reason: "already_scheduled" });
            continue;
          }
          if (alreadyQueued && alreadyQueued.length) {
            skipped.push({ title, reason: "already_queued" });
            continue;
          }
        }

        let book;
        if (sourceId === MANUAL_SOURCE_ID) {
          if (!item || !item.title) throw new Error("Missing data");
          book = buildManualBook(item);
        } else {
          const source = SOURCES[sourceId];
          if (!source || !item) throw new Error("Missing data");
          book = await source.buildBook(item);
        }

        // Copyright advisory — reuses the same best-effort catalog check the standalone
        // "Check Copyright" tab uses (see lib/copyrightCheck.js), instead of leaving it as
        // a separate tool the user has to remember to run manually before queuing a batch
        // of books. Only skips (pending force:true) on a clear "likely_copyrighted"
        // verdict — "no_match"/"uncertain" are too common and too weak a signal to block
        // an automated bulk add on, and would just train the user to always tick force.
        if (!force) {
          try {
            const copyright = await checkCopyrightStatus(event, book.title, book.author || "");
            if (copyright.verdict === "likely_copyrighted") {
              skipped.push({ title, reason: "likely_copyrighted", copyright });
              continue;
            }
          } catch (e) {
            console.error("Copyright check failed — proceeding without it:", e.message);
          }
        }

        const ratingNum = typeof book.source_rating === "number" ? book.source_rating : null;
        const record = await addToQueue(event, {
          sourceId,
          item,
          title: book.title,
          author: book.author,
          cover_url: customCoverUrl || book.cover_url || null,
          coverIsCustom: !!customCoverUrl,
          source: book.source,
          category: category || null,
          rating: ratingNum,
          fileType: fileType || null,
          publishCoverOnlyIfNoFile: !!publishCoverOnlyIfNoFile,
          description: customDescription,
          channels,
        });
        added.push(record);
      } catch (e) {
        failed.push({ title, error: e.message });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ status: "queued", added, skipped, failed }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
