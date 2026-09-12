const { getQueueItem, saveQueueSettings, markQueueAttemptFailed } = require("../lib/publishQueue");
const { publishQueueRecord } = require("../lib/queuePublisher");
const { requireAuth } = require("../lib/auth");
const { notifyPublishFailure } = require("../lib/adminAlert");

// Publishes one specific queue item right now, regardless of its position in the queue or
// whether the drip-feed's configured interval has elapsed — the "🚀 Publish now" button
// next to each item in the Publish Queue tab, for when the user doesn't want to wait for a
// particular book to come up naturally.
//
// On success, lastPublishedAt is still bumped to "now" (same as a normal drip tick) so the
// next automatic drip waits the usual interval from this real publish instead of firing
// again almost immediately. On failure, it goes through the same markQueueAttemptFailed()
// path as a failed cron tick, so repeatedly hitting "Publish now" on a broken item still
// eventually marks it "stuck" instead of being a way to retry it forever.
exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { id } = JSON.parse(event.body || "{}");
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };

    const record = await getQueueItem(event, id);
    if (!record) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

    try {
      const sendResult = await publishQueueRecord(event, record);
      await saveQueueSettings(event, { lastPublishedAt: new Date().toISOString() });
      return { statusCode: 200, body: JSON.stringify({ status: "published", message: sendResult.message }) };
    } catch (e) {
      const updated = await markQueueAttemptFailed(event, id, e.message);
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
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: e.message,
          status: updated && updated.status === "stuck" ? "stuck" : "failed",
        }),
      };
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
