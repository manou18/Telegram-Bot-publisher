const { restorePublished } = require("../lib/publishLog");
const { restoreSaved } = require("../lib/savedBooks");
const { restoreScheduled } = require("../lib/scheduledBooks");
const { requireAuth } = require("../lib/auth");

// Counterpart to /api/export — restores a previously exported backup (the same JSON shape
// export.js produces: { published, saved, scheduled }). This is a merge, not a wholesale
// replace: any record whose key already exists in its store is left alone and counted as
// "skipped" rather than overwritten, so restoring an old backup can never erase or
// downgrade something added since it was taken.

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

    if (!published.length && !saved.length && !scheduled.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "This doesn't look like a Book Index backup file." }),
      };
    }

    const [publishedResults, savedResults, scheduledResults] = await Promise.all([
      Promise.all(published.map((r) => restorePublished(event, r))),
      Promise.all(saved.map((r) => restoreSaved(event, r))),
      Promise.all(scheduled.map((r) => restoreScheduled(event, r))),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        published: tally(publishedResults),
        saved: tally(savedResults),
        scheduled: tally(scheduledResults),
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
