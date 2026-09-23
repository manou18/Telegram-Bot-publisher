// Receives update pushes directly from Telegram (set up once via setWebhook — see the
// "Reactions & Comments" section of the README) and turns two kinds of them into stats:
//
//  - message_reaction_count: a channel post's reaction counts changed. Telegram tells us
//    the chat + message_id + the new counts directly — no lookup needed beyond matching
//    that (chatId, messageId) to a book via the post-index (see postIndex.js).
//
//  - message (in a channel's linked discussion group): either the automatic copy of a
//    channel post landing in the group (which becomes a "thread root" — see
//    commentThreads.js) or a genuine comment replying into an already-known thread. A genuine
//    comment is counted for the stats and may also get a reply from the bot (commentBot.js).
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
const { packFromPayload } = require("../lib/botPlans");
const { onGroupComment } = require("../lib/commentBot");
const { processBotUpdate } = require("./bot-worker-background");
const { safeCompare } = require("../lib/auth");

// Telegram gives a bot only 10 seconds to approve a payment ("pre-checkout"), so this is answered
// right here instead of going through the slower background worker. We approve it only if it
// matches one of our own Stars packs (right payload, right currency, right price).
async function answerPreCheckout(q) {
  const pack = packFromPayload(q.invoice_payload);
  const ok = q.currency === "XTR" && !!pack && q.total_amount === pack.stars;
  const body = ok
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: "This offer is no longer available. Please open /buy and try again." };
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerPreCheckoutQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Hands a private-chat message / button tap to the interactive book bot (see
// bot-worker-background.js). This used to fire an HTTP request at that file's own
// "-background" endpoint so it would run asynchronously — but Netlify only runs
// "-background" functions on Pro plans and above; on the Free plan that request
// silently never executes anything. So instead we just call the same logic
// in-process and await it right here. The trade-off: this function is now a normal
// (non-background) function with Netlify's standard ~10 second execution limit, so a
// very slow search or a large book download could time out — acceptable for most
// public-domain PDFs/EPUBs, but worth knowing if you upgrade to Pro later and want to
// switch back to true background execution.
async function forwardToBotWorker(event, update) {
  await processBotUpdate(event, update);
}

exports.handler = async (event) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    // Fail closed: without a configured secret we can't tell a real Telegram update from a
    // forged one (fake payments, fake admin commands...), so refuse everything rather than
    // silently accepting unauthenticated requests — the opposite of what a missing secret
    // should do.
    console.error("TELEGRAM_WEBHOOK_SECRET is not set — refusing all webhook updates until it is configured.");
    return { statusCode: 500, body: "Webhook secret not configured" };
  }
  const providedSecret = (event.headers || {})["x-telegram-bot-api-secret-token"];
  if (!providedSecret || !safeCompare(providedSecret, expectedSecret)) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let update;
  try {
    update = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 200, body: "" };
  }

  try {
    if (update.pre_checkout_query) {
      await answerPreCheckout(update.pre_checkout_query);
      return { statusCode: 200, body: "" };
    }
    // Interactive book bot: private chats + inline-button taps go to the background worker.
    // Everything else (channel reactions, discussion-group comments) works exactly as before.
    if (update.callback_query || (update.message && update.message.chat && update.message.chat.type === "private")) {
      await forwardToBotWorker(event, update);
      return { statusCode: 200, body: "" };
    }
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
    await recordThreadRoot(
      event,
      chatId,
      message.message_id,
      message.forward_from_chat.id,
      message.forward_from_message_id,
      message.forward_from_chat.username
    );
    return;
  }

  // A genuine comment: it carries message_thread_id pointing at the root above. (The
  // root message itself also carries message_thread_id === its own message_id in some
  // cases — excluded here so it's never double-counted as its own first comment.)
  const threadId = message.message_thread_id;
  if (!threadId || threadId === message.message_id) return;

  const thread = await resolveThread(event, chatId, threadId);
  if (!thread) return; // this post's root was never seen — webhook likely set up after the fact

  // Counting the comment and answering it are independent: a failure in one must not skip the other.
  try {
    await incrementPostComments(event, thread.channelChatId, thread.channelMessageId);
  } catch (e) {
    console.error("Failed to count a comment:", e.message);
  }
  // Channel integration: invite the commenter to the search bot / answer /book (see commentBot.js).
  try {
    await onGroupComment(event, message, thread);
  } catch (e) {
    console.error("Comment reply failed:", e.message);
  }
}
