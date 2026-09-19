// Deep links into the interactive bot (https://t.me/<bot>?start=<payload>), used by the channel
// integration: the button under comment replies and under every published channel post.
//
// Payloads that this project understands (Telegram allows only A-Z a-z 0-9 _ - and 64 chars):
//   cmt        the customer came from a bot reply under a channel comment
//   post       the customer came from the button under a channel post
//   s_<b64>    same as "cmt", but with a ready-made search: <b64> is the base64url of the query,
//              so tapping the button opens the bot and immediately searches for it
//
// The bot's @username comes from BOT_USERNAME if set, otherwise from Telegram's getMe (cached for
// as long as the function instance stays warm). It is validated before use, because it ends up
// inside a URL button — Telegram rejects the whole message if a URL button is malformed.

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
let cachedUsername = null;

async function getBotUsername() {
  const fromEnv = (process.env.BOT_USERNAME || "").trim().replace(/^@/, "");
  if (fromEnv) {
    if (USERNAME_RE.test(fromEnv)) return fromEnv;
    console.error(`BOT_USERNAME "${fromEnv}" is not a valid Telegram username — ignoring it.`);
  }
  if (cachedUsername) return cachedUsername;

  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    const data = await r.json();
    if (data.ok && data.result && USERNAME_RE.test(data.result.username || "")) cachedUsername = data.result.username;
  } catch (e) {
    console.error("getMe failed:", e.message);
  } finally {
    clearTimeout(timer);
  }
  return cachedUsername;
}

// "https://t.me/MyBot?start=cmt", or null when the bot's username can't be determined.
async function botLink(payload) {
  const username = await getBotUsername();
  if (!username) return null;
  return `https://t.me/${username}${payload && /^[A-Za-z0-9_-]{1,64}$/.test(payload) ? `?start=${payload}` : ""}`;
}

// "Emma - Jane Austen" -> "s_RW1tYSAtIEphbmUgQXVzdGVu", or null if it wouldn't fit in 64 characters.
function encodeSearchPayload(query) {
  const q = String(query || "").replace(/\s+/g, " ").trim();
  if (!q) return null;
  const payload = "s_" + Buffer.from(q, "utf8").toString("base64url");
  return payload.length <= 64 ? payload : null;
}

// The inverse of encodeSearchPayload; returns the query text or null if the payload isn't a
// (sane) search payload.
function decodeSearchPayload(payload) {
  const m = /^s_([A-Za-z0-9_-]{1,62})$/.exec(String(payload || ""));
  if (!m) return null;
  let q;
  try {
    q = Buffer.from(m[1], "base64url").toString("utf8");
  } catch {
    return null;
  }
  q = q.replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 200 || q.startsWith("/") || q.includes("\uFFFD") || /[\u0000-\u001f]/.test(q)) return null;
  return q;
}

module.exports = { getBotUsername, botLink, encodeSearchPayload, decodeSearchPayload };
