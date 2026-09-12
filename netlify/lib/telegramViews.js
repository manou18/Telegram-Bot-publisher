// Fetches the current view count of one already-published channel post.
//
// The Bot API has no "getMessageViews" method — a channel post's view count is only ever
// included as a `views` field on a Message object, and the only Message object the Bot
// API hands back for a post we already sent is the one you get by forwarding it
// somewhere. So: forward the post to a chat the bot already talks to (ADMIN_CHAT_ID —
// reused from adminAlert.js, or VIEWS_PROBE_CHAT_ID if you'd rather use a different one),
// read `views` off the forwarded copy, then immediately delete that copy so nothing
// visible is left behind. `disable_notification` keeps this silent either way.
//
// This is a well-known workaround, not an official API, so treat the numbers it returns
// as "views as of the last refresh" rather than exact-to-the-second — see refresh-views.js
// for how often that refresh actually happens.

function getBotToken() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not set as an environment variable in Netlify.");
  }
  return BOT_TOKEN;
}

async function telegramPost(method, payload) {
  const BOT_TOKEN = getBotToken();
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function getProbeChatId() {
  return process.env.VIEWS_PROBE_CHAT_ID || process.env.ADMIN_CHAT_ID || null;
}

// Returns the view count, or null if view tracking isn't configured (no probe chat) or
// the fetch failed for any reason (post deleted since, bot no longer a member, transient
// Telegram error...) — callers treat null as "skip this one, try again next refresh"
// rather than a fatal error for the whole batch.
async function fetchPostViews(chatId, messageId) {
  const probeChatId = getProbeChatId();
  if (!probeChatId) return null;

  let forwarded;
  try {
    forwarded = await telegramPost("forwardMessage", {
      chat_id: probeChatId,
      from_chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    });
  } catch (e) {
    console.error(`Failed to forward message ${messageId} from ${chatId} to check its views:`, e.message);
    return null;
  }

  if (!forwarded.ok) {
    console.error(`Could not forward message ${messageId} from ${chatId} to check its views: ${forwarded.description}`);
    return null;
  }

  const views = typeof forwarded.result.views === "number" ? forwarded.result.views : null;

  // Best-effort cleanup — the forwarded copy has already given us what we needed, and
  // leaving it behind would slowly fill up the probe chat with duplicate posts.
  try {
    await telegramPost("deleteMessage", { chat_id: probeChatId, message_id: forwarded.result.message_id });
  } catch (e) {
    console.warn(`Failed to delete the temporary forwarded copy in the probe chat: ${e.message}`);
  }

  return views;
}

module.exports = { fetchPostViews, getProbeChatId };
