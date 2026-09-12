// Maps a comment thread in a channel's linked discussion group back to the channel post
// it belongs to, so telegram-webhook.js can turn "a new message arrived in thread X" into
// "book Y just got another comment".
//
// Telegram automatically copies every channel post into the linked discussion group as a
// message with is_automatic_forward=true, forward_from_chat (the channel) and
// forward_from_message_id (the channel's own message_id) — that copy's message_id in the
// GROUP is what every reply/comment on that post will carry as message_thread_id. So:
// the first time we see that automatic-forward copy, we record
// (groupChatId, groupMessageId) -> (channelChatId, channelMessageId); every later message
// in the group whose message_thread_id matches that groupMessageId is a comment on that
// same channel post.

const { connectLambda, getStore } = require("@netlify/blobs");

function getThreadStore(event) {
  connectLambda(event);
  return getStore("comment-threads");
}

function keyFor(groupChatId, rootMessageId) {
  return `${groupChatId}:${rootMessageId}`;
}

async function recordThreadRoot(event, groupChatId, rootMessageId, channelChatId, channelMessageId) {
  const store = getThreadStore(event);
  await store.set(
    keyFor(groupChatId, rootMessageId),
    JSON.stringify({ channelChatId, channelMessageId, createdAt: new Date().toISOString() })
  );
}

// Returns { channelChatId, channelMessageId } or null if this thread's root was never
// seen — e.g. the webhook was only set up after that post's comments already started.
async function resolveThread(event, groupChatId, rootMessageId) {
  const store = getThreadStore(event);
  const raw = await store.get(keyFor(groupChatId, rootMessageId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Mirrors cleanupOldPublished() in publishLog.js — same reasoning, separate store.
async function cleanupOldThreads(event, maxAgeMs = ONE_YEAR_MS) {
  const store = getThreadStore(event);
  const { blobs } = await store.list();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key);
      if (!raw) return;
      try {
        const record = JSON.parse(raw);
        if (record.createdAt && new Date(record.createdAt).getTime() < cutoff) {
          await store.delete(key);
          removed++;
        }
      } catch {
        // malformed entry — leave it, not this function's job to guess at it
      }
    })
  );
  return removed;
}

module.exports = { recordThreadRoot, resolveThread, cleanupOldThreads };
