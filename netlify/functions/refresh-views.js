// Runs on a timer (configured in netlify.toml, not called by the frontend) and refreshes
// view counts for a small batch of previously-published channel posts — see
// lib/telegramViews.js for how a view count is actually fetched (there's no direct Bot
// API method for it) and lib/publishLog.js's listPostsNeedingViewsRefresh() for how the
// batch is picked (oldest-refreshed-or-never-refreshed first, so every post eventually
// gets a turn instead of the same few being hit every run).
//
// Like scheduled-publish.js and cleanup.js, this needs no auth check: Netlify invokes it
// on its own with no user-supplied input, and it only ever acts on posts an authenticated
// user already published through the app.

const { listPostsNeedingViewsRefresh, updatePostViews } = require("../lib/publishLog");
const { fetchPostViews, getProbeChatId } = require("../lib/telegramViews");

const BATCH_SIZE = 15;
// Forwarding + deleting both count against Telegram's per-chat rate limit for the probe
// chat, so these are spaced out rather than fired concurrently — same reasoning as the
// DELAY_BETWEEN_MS in scheduled-publish.js, just tighter since this hits one chat instead
// of spreading across channels.
const DELAY_BETWEEN_MS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  try {
    if (!getProbeChatId()) {
      // Not configured — nothing to do. Not an error: view tracking is opt-in (set
      // ADMIN_CHAT_ID or VIEWS_PROBE_CHAT_ID to turn it on), see the README.
      return { statusCode: 200, body: JSON.stringify({ skipped: "No probe chat configured — view tracking is off." }) };
    }

    const tasks = await listPostsNeedingViewsRefresh(event, BATCH_SIZE);
    let updated = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        const views = await fetchPostViews(task.chatId, task.messageId);
        if (views !== null) {
          await updatePostViews(event, task.key, task.chatId, task.messageId, views);
          updated++;
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`Failed to refresh views for message ${task.messageId} in chat ${task.chatId}:`, e.message);
        failed++;
      }
      await sleep(DELAY_BETWEEN_MS);
    }

    return { statusCode: 200, body: JSON.stringify({ checked: tasks.length, updated, failed }) };
  } catch (e) {
    console.error("refresh-views run failed:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
