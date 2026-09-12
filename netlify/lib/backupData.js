// Shared by the manual "⬇️ Export Backup" button (functions/export.js) and the automated
// scheduled backup (functions/scheduled-backup.js), so both ever produce exactly the same
// data shape — one place to update if a new store is ever worth including in the backup.

const { listPublished } = require("./publishLog");
const { listSaved } = require("./savedBooks");
const { listScheduled } = require("./scheduledBooks");
const { listQueue, getQueueSettings } = require("./publishQueue");

async function buildBackup(event) {
  const [published, saved, scheduled, queue, queueSettings] = await Promise.all([
    listPublished(event),
    listSaved(event),
    listScheduled(event),
    listQueue(event),
    getQueueSettings(event),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    counts: { published: published.length, saved: saved.length, scheduled: scheduled.length, queue: queue.length },
    published,
    saved,
    scheduled,
    queue,
    queueSettings,
  };
}

module.exports = { buildBackup };
