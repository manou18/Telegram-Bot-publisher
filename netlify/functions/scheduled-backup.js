// Runs once a day (see netlify.toml) and pushes the same backup data the manual
// "⬇️ Export Backup" button produces (see lib/backupData.js) to a GitHub repo — so a
// current backup exists somewhere outside Netlify Blobs even if nobody remembers to
// click the button. Not called by the frontend, and a no-op if not configured.
//
// Like refresh-views.js/check-dead-links.js, this needs no auth check: Netlify invokes
// it on its own with no user-supplied input.

const { buildBackup } = require("../lib/backupData");
const { uploadBackup } = require("../lib/githubBackup");
const { notifyBackupFailure } = require("../lib/adminAlert");

const DEFAULT_PATH = "backups/book-index-backup.json";

exports.handler = async (event) => {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const repo = process.env.GITHUB_BACKUP_REPO;

  if (!token || !repo) {
    // Not configured — nothing to do. Not an error: this feature is opt-in, see the
    // README's "Automated backups" section.
    return { statusCode: 200, body: JSON.stringify({ skipped: "GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO not set." }) };
  }

  const filePath = process.env.GITHUB_BACKUP_PATH || DEFAULT_PATH;

  try {
    const backup = await buildBackup(event);
    await uploadBackup(repo, filePath, JSON.stringify(backup, null, 2));
    return { statusCode: 200, body: JSON.stringify({ ok: true, counts: backup.counts }) };
  } catch (e) {
    console.error("scheduled-backup failed:", e.message);
    await notifyBackupFailure(e.message).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
