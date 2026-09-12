const { restorePublished } = require("../lib/publishLog");
const { restoreSaved } = require("../lib/savedBooks");
const { restoreScheduled } = require("../lib/scheduledBooks");
const { restoreQueueItem, saveQueueSettings } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

// Counterpart to /api/export — restores a previously exported backup (the same JSON shape
// export.js produces: { published, saved, scheduled, queue, queueSettings }). This is a
// merge, not a wholesale replace: any record whose key already exists in its store is left
// alone and counted as "skipped" rather than overwritten, so restoring an old backup can
// never erase or downgrade something added since it was taken. queueSettings (the
// enabled flag + interval) is the one exception — being a single shared record rather than
// a list, it's only applied if the backup has it AND this import actually introduced queue
// items, to avoid silently flipping a drip-feed that's already running.

function tally(results) {
  return results.reduce(
    (acc, r) => {
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    },
    { imported: 0, skipped: 0, invalid: 0 }
  );
}

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    let backup;
    try {
      backup = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "That file isn't valid JSON." }) };
    }

    const published = Array.isArray(backup.published) ? backup.published : [];
    const saved = Array.isArray(backup.saved) ? backup.saved : [];
    const scheduled = Array.isArray(backup.scheduled) ? backup.scheduled : [];
    const queue = Array.isArray(backup.queue) ? backup.queue : [];

    if (!published.length && !saved.length && !scheduled.length && !queue.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "This doesn't look like a Book Index backup file." }),
      };
    }

    const [publishedResults, savedResults, scheduledResults, queueResults] = await Promise.all([
      Promise.all(published.map((r) => restorePublished(event, r))),
      Promise.all(saved.map((r) => restoreSaved(event, r))),
      Promise.all(scheduled.map((r) => restoreScheduled(event, r))),
      Promise.all(queue.map((r) => restoreQueueItem(event, r))),
    ]);

    let queueSettingsApplied = false;
    if (backup.queueSettings && typeof backup.queueSettings === "object") {
      const importedCount = queueResults.filter((r) => r === "imported").length;
      if (importedCount > 0) {
        const { enabled, intervalMinutes } = backup.queueSettings;
        const patch = {};
        if (typeof enabled === "boolean") patch.enabled = enabled;
        if (typeof intervalMinutes === "number" && intervalMinutes >= 5) patch.intervalMinutes = Math.round(intervalMinutes);
        if (Object.keys(patch).length) {
          await saveQueueSettings(event, patch);
          queueSettingsApplied = true;
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        published: tally(publishedResults),
        saved: tally(savedResults),
        scheduled: tally(scheduledResults),
        queue: tally(queueResults),
        queueSettingsApplied,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
