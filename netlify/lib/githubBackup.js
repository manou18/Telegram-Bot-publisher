// Uploads a backup JSON string to a file in a GitHub repo, via GitHub's Contents API —
// no extra dependency needed (unlike S3, which would need request-signing via the AWS
// SDK), just plain authenticated HTTP requests, same as every Telegram call elsewhere in
// this app.
//
// Deliberately writes to the SAME file path every time (rather than a new dated file per
// run) — GitHub already keeps every previous version of a file in its own commit
// history for free, so this gets a full backup history with zero extra cleanup logic,
// instead of a repo that grows one new file per day forever.

const GITHUB_API = "https://api.github.com";

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const r = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// The Contents API requires the current file's `sha` to update it (a plain safety check
// against overwriting someone else's concurrent change) — null on the very first run,
// when the file doesn't exist yet, in which case GitHub just creates it fresh.
async function getExistingSha(repo, filePath) {
  const { ok, data } = await githubRequest(`/repos/${repo}/contents/${encodeURI(filePath)}`);
  return ok && data.sha ? data.sha : null;
}

// repo: "owner/name" (e.g. "yourname/book-index-backups"). Throws on failure — the
// caller (scheduled-backup.js) is responsible for turning that into an admin alert.
async function uploadBackup(repo, filePath, contentString) {
  const sha = await getExistingSha(repo, filePath);
  const body = {
    message: `Automated backup — ${new Date().toISOString().slice(0, 10)}`,
    content: Buffer.from(contentString, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const { ok, status, data } = await githubRequest(`/repos/${repo}/contents/${encodeURI(filePath)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!ok) {
    throw new Error(data.message || `GitHub API returned HTTP ${status}`);
  }
  return data;
}

module.exports = { uploadBackup };
