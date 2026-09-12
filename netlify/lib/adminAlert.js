// Best-effort admin notifications sent over Telegram (via the same bot) when an
// unattended publish fails — either a one-off scheduled book, or a drip-feed queue item
// that's exhausted its retries and gone "stuck" — instead of that failure only ever
// showing up as a line in Netlify's function logs that nobody happens to be watching.
//
// Configure ADMIN_CHAT_ID (your personal Telegram chat id, or a private admin group/
// channel the bot is a member of — anything the bot is allowed to message) to enable
// this. Left unset, nothing is sent and nothing else about the app changes — this is
// purely additive and never blocks or fails the publish flow itself: every call here is
// wrapped so a broken/misconfigured alert can never turn into a publish failure.
//
// To find your own chat id: message your bot anything (e.g. "/start"), then open
// https://api.telegram.org/bot<BOT_TOKEN>/getUpdates in a browser and look for
// "chat":{"id": ...} in the response — that number is your ADMIN_CHAT_ID.

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendAdminMessage(text) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return false; // not configured — silently skip

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error("Admin alert failed to send:", data.description || "unknown error");
      return false;
    }
    return true;
  } catch (e) {
    console.error("Admin alert failed to send:", e.message);
    return false;
  }
}

// kind: "scheduled"   — a one-off scheduled book failed on its only attempt.
//       "queue_stuck" — a drip-feed queue item hit MAX_ATTEMPTS and is now stuck (the
//                        queue keeps flowing past it, but it needs a human to look at it).
async function notifyPublishFailure({ kind, title, author, source, error, attempts }) {
  const icon = kind === "queue_stuck" ? "🛑" : "⚠️";
  const label =
    kind === "queue_stuck"
      ? `Publish Queue item stuck after ${attempts || "several"} failed attempts`
      : "Scheduled publish failed";
  const lines = [
    `${icon} <b>${escapeHtml(label)}</b>`,
    `📖 ${escapeHtml(title || "Untitled")}${author ? ` — ${escapeHtml(author)}` : ""}`,
  ];
  if (source) lines.push(`📚 ${escapeHtml(source)}`);
  lines.push(`❗ ${escapeHtml(error || "Unknown error")}`);
  // Never let a broken/misconfigured alert bubble up into the caller's own error
  // handling — this is a side-channel notification, not part of the publish flow itself.
  await sendAdminMessage(lines.join("\n")).catch(() => false);
}

// Sent by the check-dead-links cron job the first time a book's download link fails two
// consecutive checks in a row (see updateLinkCheckResult in publishLog.js) — not on
// every recheck of an already-known-dead link, just the initial transition into "dead".
async function notifyDeadLink({ title, author, source, download_url }) {
  const lines = [
    `🔗💀 <b>Dead download link detected</b>`,
    `📖 ${escapeHtml(title || "Untitled")}${author ? ` — ${escapeHtml(author)}` : ""}`,
  ];
  if (source) lines.push(`📚 ${escapeHtml(source)}`);
  lines.push(`❌ ${escapeHtml(download_url || "")}`);
  await sendAdminMessage(lines.join("\n")).catch(() => false);
}

// Sent by the scheduled-backup cron job (see functions/scheduled-backup.js) whenever a
// scheduled GitHub backup run fails outright — an expired token, a renamed/deleted repo,
// a GitHub outage — so a silently-broken backup doesn't go unnoticed for months.
async function notifyBackupFailure(error) {
  const lines = [`🗄️❌ <b>Automated backup failed</b>`, `❗ ${escapeHtml(error || "Unknown error")}`];
  await sendAdminMessage(lines.join("\n")).catch(() => false);
}

module.exports = { notifyPublishFailure, notifyDeadLink, notifyBackupFailure };
