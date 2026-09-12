// A small side-index: (chatId, messageId) -> the publish-log store key that owns that
// post. Needed because incoming Telegram webhook updates (reactions, comments — see
// telegram-webhook.js) only ever tell us WHICH message something happened to, never
// which book that message belongs to. Without this, matching a reaction/comment back to
// a book would mean scanning every published record on every single incoming update —
// fine at a handful of books, unworkable once the log grows. Populated once per post at
// publish time (see recordPublished in publishLog.js), and lazily backfilled by
// refresh-views.js for any older post that predates this index (see its comment).

const { connectLambda, getStore } = require("@netlify/blobs");

function getIndexStore(event) {
  connectLambda(event);
  return getStore("post-index");
}

function keyFor(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

async function indexPost(event, chatId, messageId, recordKey) {
  const store = getIndexStore(event);
  await store.set(keyFor(chatId, messageId), recordKey);
}

// Returns the publish-log key for this (chatId, messageId), or null if it was never
// indexed (predates this feature and hasn't been backfilled yet — see refresh-views.js).
async function lookupPostKey(event, chatId, messageId) {
  const store = getIndexStore(event);
  try {
    return await store.get(keyFor(chatId, messageId));
  } catch {
    return null;
  }
}

module.exports = { indexPost, lookupPostKey };
