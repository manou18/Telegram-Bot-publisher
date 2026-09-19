// Channel integration: what the bot does when someone comments under a channel post.
//
//  1. Invite reply — a short, friendly reply under a genuine comment that points the commenter
//     to the search bot, with a button that opens it (https://t.me/<bot>?start=cmt).
//  2. /book <title - author> typed in the comments — the bot answers with a button that opens
//     a private chat and runs that search immediately (payload "s_<base64url query>", see
//     botLinks.js and the /start handling in bot-worker-background.js).
//
// Because a bot posting in a public discussion group can very quickly turn into spam, this is
// deliberately restrained. It only ever replies when ALL of these hold:
//   - the thread belongs to one of YOUR channels (a post this app published, or a channel listed
//     in TELEGRAM_CHANNELS / CHANNEL_ID). Anyone can add a bot to any group, so without this the
//     bot would start posting in groups that have nothing to do with you;
//   - the comment is written by a real person: not a bot, not an admin, not "sent as" a channel,
//     not you (ADMIN_CHAT_ID), and it has actual words (not just an emoji or a sticker);
//   - it is a top-level comment, not a reply inside a conversation between commenters;
//   - the same person hasn't been answered within COMMENT_REPLY_COOLDOWN_HOURS (default 24);
//   - the post hasn't already collected COMMENT_REPLY_MAX_PER_THREAD invites (default 5; 0 = no cap);
//   - the group hasn't exceeded COMMENT_REPLY_MAX_PER_HOUR bot messages this hour (default 20);
//   - a previous attempt didn't just fail (then it waits 30 minutes and tells you once).
// COMMENT_REPLIES=off switches all of it off. /book answers are explicit requests, so they skip
// the invite limits above and only have a small per-person rate limit.
//
// State lives in the Netlify Blobs store "bot-comments" (tiny per-user / per-thread / per-group
// records). Blobs has no transactions, so two simultaneous comments can occasionally both get a
// reply — harmless. Everything here is best-effort: the webhook catches and logs any error.

const { connectLambda, getStore } = require("@netlify/blobs");
const { tg, esc } = require("./bookBot");
const { getChannels } = require("./channels");
const { lookupPostKey } = require("./postIndex");
const { getBotUsername, botLink, encodeSearchPayload } = require("./botLinks");
const { track } = require("./botStats");

const HOUR = 60 * 60 * 1000;
const FAILURE_PAUSE_MS = 30 * 60 * 1000;
const FAILURE_NOTICE_EVERY_MS = 6 * HOUR;
const CMD_MAX_PER_HOUR = 10;
const CMD_MIN_GAP_MS = 5000;
const GROUP_MIN_GAP_MS = 3000; // Telegram allows ~20 messages/minute per group; stay well below

const num = (v, d) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const config = () => ({
  enabled: !/^(off|false|0|no)$/i.test(String(process.env.COMMENT_REPLIES || "on").trim()),
  cooldownMs: num(process.env.COMMENT_REPLY_COOLDOWN_HOURS, 24) * HOUR,
  maxPerThread: num(process.env.COMMENT_REPLY_MAX_PER_THREAD, 5),
  maxPerHour: num(process.env.COMMENT_REPLY_MAX_PER_HOUR, 20),
});

const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------------------------------------------------------------- copy (English)

// Someone asking for / about a book gets the more direct wording.
const REQUEST_RE = new RegExp(
  "\\b(?:pdf|epub|mobi|download|link|where|do you have|have you|can you|could you|please|plz|need|looking for|request|send|available|another|more books?)\\b" +
    "|تحميل|رابط|أريد|اريد|أبحث|ابحث|هل (?:يوجد|عندكم|لديكم|تملكون)|كتاب|رواية|ممكن",
  "i"
);

const INVITES = [
  () => "📚 <b>Looking for another book?</b>\nSend me the <b>title and author</b> in a private chat and I'll find a free, legal PDF or EPUB for you.",
  (name) => `👋 Hi${name ? ` ${esc(short(name, 30))}` : ""}! I can search open libraries for any English book — just message me the <b>title and author</b>.`,
  () => "🔎 <b>Need a different book?</b>\nTap the button, send me the title, and I'll bring back a free PDF or EPUB in seconds.",
];
const TIP = "\n\n<i>Tip: you can also type</i> <code>/book Title - Author</code> <i>right here.</i>";
const REQUEST_INVITES = [
  () => "📥 <b>Looking for a specific book?</b>\nSend me its <b>title and author</b> and I'll look for a free PDF or EPUB right away." + TIP,
  () => "🔎 <b>I can help with that!</b>\nTell me the <b>title and author</b> in a private chat and I'll search the open libraries for you." + TIP,
];

// ---------------------------------------------------------------- state

const store = (event) => {
  connectLambda(event);
  return getStore("bot-comments");
};

async function read(s, key, fallback) {
  try {
    const raw = await s.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
const write = (s, key, value) => s.set(key, JSON.stringify(value));

// Returns why an invite must NOT be sent, or null if it may.
async function blockedReason(s, cfg, { groupId, threadId, userId }) {
  const now = Date.now();
  const fail = await read(s, `fail:${groupId}`, null);
  if (fail && now - fail.at < FAILURE_PAUSE_MS) return "recent_failure";
  const user = await read(s, `user:${userId}`, null);
  if (user && now - user.at < cfg.cooldownMs) return "user_cooldown";
  if (cfg.maxPerThread > 0) {
    const thread = await read(s, `thread:${groupId}:${threadId}`, { n: 0 });
    if (thread.n >= cfg.maxPerThread) return "thread_cap";
  }
  const group = await read(s, `group:${groupId}`, { hits: [] });
  const recent = group.hits.filter((t) => now - t < HOUR);
  if (recent.length >= cfg.maxPerHour) return "hour_cap";
  if (recent.length && now - recent[recent.length - 1] < GROUP_MIN_GAP_MS) return "too_fast";
  return null;
}

async function commitInvite(s, { groupId, threadId, userId }) {
  const now = Date.now();
  const group = await read(s, `group:${groupId}`, { hits: [] });
  const thread = await read(s, `thread:${groupId}:${threadId}`, { n: 0 });
  await Promise.all([
    write(s, `user:${userId}`, { at: now }),
    write(s, `thread:${groupId}:${threadId}`, { n: thread.n + 1 }),
    write(s, `group:${groupId}`, { hits: [...group.hits.filter((t) => now - t < HOUR), now] }),
  ]);
}

// /book is an explicit request: only stop someone from hammering it.
async function commandAllowed(s, userId) {
  const now = Date.now();
  const rec = await read(s, `cmd:${userId}`, { hits: [] });
  const recent = rec.hits.filter((t) => now - t < HOUR);
  if (recent.length >= CMD_MAX_PER_HOUR) return false;
  if (recent.length && now - recent[recent.length - 1] < CMD_MIN_GAP_MS) return false;
  await write(s, `cmd:${userId}`, { hits: [...recent, now] });
  return true;
}

// Posting failed (bot removed from the group, group restricts members, flood limit…): pause for a
// while and tell the owner once in a while, instead of failing silently or hammering Telegram.
async function recordFailure(s, groupId, error) {
  const now = Date.now();
  const prev = await read(s, `fail:${groupId}`, {});
  const notify = !prev.notifiedAt || now - prev.notifiedAt > FAILURE_NOTICE_EVERY_MS;
  await write(s, `fail:${groupId}`, { at: now, notifiedAt: notify ? now : prev.notifiedAt });
  console.error(`Comment reply failed in group ${groupId}:`, error.message);
  if (notify && process.env.ADMIN_CHAT_ID) {
    await tg("sendMessage", {
      chat_id: process.env.ADMIN_CHAT_ID,
      text:
        `⚠️ Comment replies are on, but I couldn't post in the discussion group (chat ${groupId}):\n${error.message}\n\n` +
        "Check that the bot is a member of the group and allowed to send messages. Set COMMENT_REPLIES=off to silence this.",
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- "is this our channel?"

function isConfiguredChannel(chatId, username) {
  return getChannels().some((c) => {
    const id = String(c.chat_id);
    if (id.startsWith("@")) return !!username && id.slice(1).toLowerCase() === String(username).toLowerCase();
    return id === String(chatId);
  });
}

// True for a post this app published (the post-index knows it), or for any post of a channel
// listed in TELEGRAM_CHANNELS / CHANNEL_ID.
async function isOurThread(event, thread) {
  if (isConfiguredChannel(thread.channelChatId, thread.channelUsername)) return true;
  return !!(await lookupPostKey(event, thread.channelChatId, thread.channelMessageId));
}

async function isGroupAdmin(groupId, userId) {
  try {
    const m = await tg("getChatMember", { chat_id: groupId, user_id: userId });
    const status = m && (m.status || (m.result && m.result.status));
    return status === "creator" || status === "administrator";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- sending

function reply(message, text, url, label) {
  return tg("sendMessage", {
    chat_id: message.chat.id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    reply_markup: { inline_keyboard: [[{ text: label, url }]] },
  });
}

// ---------------------------------------------------------------- entry point

// Called by telegram-webhook.js for every comment in a thread whose channel post is known.
async function onGroupComment(event, message, thread) {
  const cfg = config();
  if (!cfg.enabled) return;
  const from = message.from;
  if (!from || from.is_bot || message.sender_chat || message.is_automatic_forward) return;
  if (process.env.ADMIN_CHAT_ID && String(from.id) === String(process.env.ADMIN_CHAT_ID)) return;
  if (!(await isOurThread(event, thread))) return;

  const text = (message.text || message.caption || "").trim();
  const ctx = { groupId: message.chat.id, threadId: message.message_thread_id, userId: from.id };
  const cmd = /^\/(book|search|find)(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text);
  if (cmd) return onBookCommand(event, message, cmd, ctx);
  if (text.startsWith("/")) return; // some other command — not ours to answer
  if (!/\p{L}{2,}/u.test(text)) return; // an emoji, a sticker, "+1"…
  if (message.reply_to_message && message.reply_to_message.message_id !== ctx.threadId) return; // a chat between commenters

  const link = await botLink("cmt");
  if (!link) return;
  const s = store(event);
  if (await blockedReason(s, cfg, ctx)) return;
  if (await isGroupAdmin(ctx.groupId, from.id)) return;

  const pool = REQUEST_RE.test(text) ? REQUEST_INVITES : INVITES;
  const body = pool[Math.abs(message.message_id) % pool.length](from.first_name);
  try {
    await reply(message, body, link, "🔎 Search books in the bot");
  } catch (e) {
    return void (await recordFailure(s, ctx.groupId, e));
  }
  await Promise.all([commitInvite(s, ctx), track(event, { cmtReply: 1 })]);
}

async function onBookCommand(event, message, cmd, ctx) {
  const username = await getBotUsername();
  if (cmd[2] && (!username || cmd[2].toLowerCase() !== username.toLowerCase())) return; // meant for another bot
  const s = store(event);
  if (!(await commandAllowed(s, ctx.userId))) return;

  const query = (cmd[3] || "").replace(/\s+/g, " ").trim();
  const payload = query ? encodeSearchPayload(query) : null;
  const link = await botLink(payload || "cmt");
  if (!link) return;

  let body, label;
  if (payload) {
    body = `🔎 <b>Got it!</b> Tap the button to search for <i>“${esc(short(query, 80))}”</i> in a private chat with me.`;
    label = "📥 Open in the bot";
  } else if (query) {
    body = "📏 <b>That title is a bit long for a quick link.</b>\nOpen the bot and send it there:";
    label = "🔎 Open the bot";
  } else {
    body = "✏️ <b>Add a title after the command</b>, for example:\n<code>/book Pride and Prejudice - Jane Austen</code>";
    label = "🔎 Open the bot";
  }
  try {
    await reply(message, body, link, label);
  } catch (e) {
    return void (await recordFailure(s, ctx.groupId, e));
  }
  await track(event, { cmtCmd: 1 });
}

module.exports = { onGroupComment, isConfiguredChannel };
