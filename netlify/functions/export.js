const { listPublished } = require("../lib/publishLog");
const { listSaved } = require("../lib/savedBooks");
const { listScheduled } = require("../lib/scheduledBooks");
const { listQueue, getQueueSettings } = require("../lib/publishQueue");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const [published, saved, scheduled, queue, queueSettings] = await Promise.all([
      listPublished(event),
      listSaved(event),
      listScheduled(event),
      listQueue(event),
      getQueueSettings(event),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      counts: { published: published.length, saved: saved.length, scheduled: scheduled.length, queue: queue.length },
      published,
      saved,
      scheduled,
      queue,
      queueSettings,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="book-index-backup-${stamp}.json"`,
      },
      body: JSON.stringify(backup, null, 2),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
