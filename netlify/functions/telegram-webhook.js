// Receives update pushes directly from Telegram (set up once via setWebhook — see the
// "Reactions & Comments" section of the README) and turns two kinds of them into stats:
//
//  - message_reaction_count: a channel post's reaction counts changed. Telegram tells us
//    the chat + message_id + the new counts directly — no lookup needed beyond matching
//    that (chatId, messageId) to a book via the post-index (see postIndex.js).
//
//  - message (in a channel's linked discussion group): either the automatic copy of a
//    channel post landing in the group (which becomes a "thread root" — see
//    commentThreads.js) or a genuine comment replying into an already-known thread.
//
// Like feed.js, this is intentionally NOT behind requireAuth — Telegram calls it
// directly and can't send X-Site-Password. Authenticity instead comes from the
// secret_token Telegram echoes back in a header, set once via setWebhook and checked
// against TELEGRAM_WEBHOOK_SECRET below.
//
// Always responds 200 (even on a processing error) unless the secret check fails —
// Telegram retries a webhook aggressively on non-200s, and retrying a single malformed
// or momentarily-unmatchable update forever helps no one.

const { updatePostReactions, incrementPostComments } = require("../lib/publishLog");
const { recordThreadRoot, resolveThread } = require("../lib/commentThreads");

exports.handler = async (event) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = (event.headers || {})["x-telegram-bot-api-secret-token"];
  if (expectedSecret && providedSecret !== expectedSecret) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let update;
  try {
    update = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 200, body: "" };
  }

  try {
    if (update.message_reaction_count) {
      await handleReactionCount(event, update.message_reaction_count);
    } else if (update.message) {
      await handleGroupMessage(event, update.message);
    }
  } catch (e) {
    console.error("Failed to process a Telegram webhook update:", e.message);
  }

  return { statusCode: 200, body: "" };
};

async function handleReactionCount(event, payload) {
  const chatId = payload.chat && payload.chat.id;
  const messageId = payload.message_id;
  if (!chatId || !messageId) return;
  await updatePostReactions(event, chatId, messageId, payload.reactions || []);
}

async function handleGroupMessage(event, message) {
  const chatId = message.chat && message.chat.id;
  if (!chatId) return;

  // The channel post's automatic copy landing in the discussion group — this message's
  // own id in the group is the thread root every comment on that post will reference.
  if (message.is_automatic_forward && message.forward_from_chat && message.forward_from_message_id) {
    await recordThreadRoot(event, chatId, message.message_id, message.forward_from_chat.id, message.forward_from_message_id);
    return;
  }

  // A genuine comment: it carries message_thread_id pointing at the root above. (The
  // root message itself also carries message_thread_id === its own message_id in some
  // cases — excluded here so it's never double-counted as its own first comment.)
  const threadId = message.message_thread_id;
  if (!threadId || threadId === message.message_id) return;

  const thread = await resolveThread(event, chatId, threadId);
  if (!thread) return; // this post's root was never seen — webhook likely set up after the fact

  await incrementPostComments(event, thread.channelChatId, thread.channelMessageId);
}
