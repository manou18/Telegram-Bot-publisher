// Runs on a timer (configured in netlify.toml, not called by the frontend) and publishes
// any scheduled book whose target time has arrived. Netlify invokes this on its own —
// there's no X-Site-Password header to check here, which is fine: it only ever acts on
// books an authenticated user already scheduled through /api/schedule, it never accepts
// arbitrary input from the request itself.
//
// Besides the one-off "scheduled books" handled below, this same run also drains the
// persistent drip-feed queue (see lib/publishQueue.js): at most one queued book per run,
// and only once the configured interval has actually elapsed since the last drip — this
// is what makes "group scheduling" self-sustaining (add a batch once, it trickles out on
// its own) without needing a cron finer than the 5-minute one already defined in
// netlify.toml.

const { SOURCES } = require("../lib/sources");
const { sendBook } = require("../lib/telegram");
const { recordPublished } = require("../lib/publishLog");
const { unsaveBook } = require("../lib/savedBooks");
const { getDuePending, markScheduledResult } = require("../lib/scheduledBooks");
const {
  getQueueSettings,
  saveQueueSettings,
  peekNext,
  markQueueAttemptFailed,
} = require("../lib/publishQueue");
const { publishQueueRecord } = require("../lib/queuePublisher");
const { buildManualBook, MANUAL_SOURCE_ID } = require("../lib/manualSource");
const { notifyPublishFailure } = require("../lib/adminAlert");

const DELAY_BETWEEN_MS = 2000; // spread posts out a bit, same reasoning as the bulk-publish UI

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Publishes the single oldest item in the drip-feed queue, but only if the queue is
// enabled AND the configured interval has actually elapsed since the last drip. Mutates
// `results` (same shape as the per-record entries below) so the cron's response reflects
// both kinds of activity in one place.
async function runQueueTick(event, results) {
  const settings = await getQueueSettings(event);
  if (!settings.enabled) return;

  const dueNow =
    !settings.lastPublishedAt ||
    Date.now() - new Date(settings.lastPublishedAt).getTime() >= settings.intervalMinutes * 60000;
  if (!dueNow) return;

  const record = await peekNext(event);
  if (!record) return; // queue is empty — nothing to drip right now

  try {
    const sendResult = await publishQueueRecord(event, record);
    await saveQueueSettings(event, { lastPublishedAt: new Date().toISOString() });
    results.push({ id: record.id, status: "published", queue: true, message: sendResult.message });
  } catch (e) {
    console.error(`Queue publish failed for ${record.id} (${record.title}):`, e.message);
    // Left in the queue and lastPublishedAt left untouched — a transient failure (network
    // blip, Telegram hiccup) gets retried on the next due tick instead of silently
    // skipping the book or advancing the schedule past it. But that retry isn't unlimited
    // any more: after MAX_ATTEMPTS consecutive failures the item is marked "stuck"
    // (surfaced in the Publish Queue tab) instead of hammering the same broken item every
    // 5 minutes forever and blocking everything queued behind it — peekNext() skips
    // "stuck" items, so the queue keeps flowing past it.
    const updated = await markQueueAttemptFailed(event, record.id, e.message);
    results.push({
      id: record.id,
      status: updated && updated.status === "stuck" ? "stuck" : "failed",
      queue: true,
      attempts: updated ? updated.attempts : undefined,
      error: e.message,
    });
    // Only alert once this item is actually "stuck" (retries exhausted) — not on every
    // transient failure, which would otherwise message the admin every 5 minutes for as
    // long as a flaky source stays down.
    if (updated && updated.status === "stuck") {
      await notifyPublishFailure({
        kind: "queue_stuck",
        title: record.title,
        author: record.author,
        source: record.source,
        error: e.message,
        attempts: updated.attempts,
      });
    }
  }
}

exports.handler = async (event) => {
  try {
    const due = await getDuePending(event, new Date().toISOString());
    const results = [];

    for (const record of due) {
      try {
        const source = SOURCES[record.sourceId];
        if (!source && record.sourceId !== MANUAL_SOURCE_ID) throw new Error(`Unknown source ${record.sourceId}`);

        const book = record.sourceId === MANUAL_SOURCE_ID ? buildManualBook(record.item) : await source.buildBook(record.item);
        book.rating = record.rating;
        book.category = record.category || null;
        // Carry forward a manually-uploaded/pasted cover from schedule time, instead of the
        // fresh cover_url buildBook() just fetched from the source — mirrors the
        // description handling right below, and fixes the same "edit gets silently
        // dropped" bug for covers.
        if (record.cover_is_custom && record.cover_url) {
          book.cover_url = record.cover_url;
        }
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

        const sendResult = await sendBook(book, !!record.publishCoverOnlyIfNoFile, record.channels);

        try {
          await recordPublished(event, record.sourceId, record.item, book, sendResult.posts);
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
        // A one-off schedule only ever gets this one attempt (unlike the queue, which
        // retries up to MAX_ATTEMPTS) — so this failure is final the moment it happens,
        // and the admin is alerted right away rather than waiting on any threshold.
        await notifyPublishFailure({
          kind: "scheduled",
          title: record.title,
          author: record.author,
          source: record.source,
          error: e.message,
        });
      }

      await sleep(DELAY_BETWEEN_MS);
    }

    await runQueueTick(event, results);

    return { statusCode: 200, body: JSON.stringify({ processed: results.length, results }) };
  } catch (e) {
    console.error("scheduled-publish run failed:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
