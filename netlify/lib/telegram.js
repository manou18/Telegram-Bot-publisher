// First tries passing the file URL directly to Telegram (lighter on the Netlify function,
// since Telegram is the one fetching the file, not us). Only when this method fails — usually
// due to file size — does it fall back to downloading it here temporarily and then uploading it
// as a file (multipart), which increases the function's execution time, so watch the timeout
// limit in Netlify's settings when publishing large books (see the limits note in the README).

const { buildCoverMockup } = require("./coverMockup");
const { resolveChatIds } = require("./channels");
const { createDescriptionPage } = require("./telegraph");

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
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Call to ${method} failed`);
  return data;
}

async function sendPhotoBuffer(chatId, buffer, caption) {
  const BOT_TOKEN = getBotToken();
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("photo", new Blob([buffer], { type: "image/png" }), "cover.png");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Failed to send the generated cover mockup");
  return data;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text, max) {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

// Room left, within maxDescLen, for the "🔗 <a>...</a>" link line itself once a
// description is long enough to need one — otherwise the teaser + link together could
// still overflow the same limit we're trying to respect.
const TELEGRAPH_LINK_MARGIN = 150;

// Builds the "📝 ..." description block for the caption. A description that fits within
// maxDescLen is shown in full, exactly as before. A longer one used to just get cut off
// mid-sentence with an ellipsis — instead, we publish the full text to a Telegra.ph page
// (see telegraph.js) and show a short teaser plus a link to the rest, so nothing the
// source (or an AI rewrite) wrote is ever actually lost, regardless of length.
async function buildDescriptionPart(book, maxDescLen) {
  if (!book.description) return "";
  const trimmed = String(book.description).trim();
  if (!trimmed) return "";

  if (trimmed.length <= maxDescLen) {
    return `\n\n📝 ${escapeHtml(trimmed)}`;
  }

  let pageUrl = null;
  try {
    pageUrl = await createDescriptionPage(book);
  } catch (e) {
    console.warn(`Failed to create a Telegra.ph page for the description (${e.message}), falling back to truncating it.`);
  }

  if (!pageUrl) {
    return `\n\n📝 ${escapeHtml(truncate(trimmed, maxDescLen))}`;
  }

  const teaser = truncate(trimmed, Math.max(maxDescLen - TELEGRAPH_LINK_MARGIN, 100));
  return `\n\n📝 ${escapeHtml(teaser)}\n\n🔗 <a href="${pageUrl}">الوصف الكامل على Telegraph</a>`;
}

// Book covers are usually tall/portrait (~2:3), which makes Telegram's channel feed apply a
// center-crop that cuts off the top and bottom of the image (title/author get chopped off).
// The linked discussion group doesn't do this — it shows the photo uncropped. To make the
// channel view match, we route the cover through a free image-proxy (wsrv.nl) that pads it
// onto a square canvas with a white background instead of letting Telegram crop it.
function paddedCoverUrl(coverUrl) {
  const encoded = encodeURIComponent(coverUrl);
  return `https://wsrv.nl/?url=${encoded}&w=1000&h=1000&fit=contain&bg=ffffff`;
}

async function sendCoverAndCaption(book, chatId) {
  // Telegram's photo caption limit is 1024 characters, while a text message allows 4096,
  // so we give the description more room when there's no cover being sent as a photo.
  const maxDescLen = book.cover_url ? 500 : 1500;
  const descriptionPart = await buildDescriptionPart(book, maxDescLen);
  // book.rating now comes straight from the source's real reader rating (Open Library /
  // Google Books) when one exists, so it can be a decimal like 4.3 rather than a whole
  // number — round for the star count, but keep the decimal in the printed "x/5".
  let ratingPart = "";
  if (typeof book.rating === "number" && book.rating > 0) {
    const display = Number.isInteger(book.rating) ? String(book.rating) : book.rating.toFixed(1);
    ratingPart = `\n${"⭐".repeat(Math.round(book.rating))} (${display}/5 — reader rating)`;
  }
  const caption = `📚 <b>${escapeHtml(book.title)}</b>\n✍️ ${escapeHtml(book.author)}\n📖 ${escapeHtml(book.source)}${ratingPart}${descriptionPart}`;
  // The message id of this cover/caption post (returned below) is what view counts get
  // tracked against later (see lib/telegramViews.js + refresh-views.js) — it's the one
  // message per channel that actually represents "this book's listing", whether or not a
  // separate file document also gets sent after it.
  let sendResult;
  if (book.cover_url) {
    try {
      const mockupBuffer = await buildCoverMockup(book.cover_url);
      sendResult = await sendPhotoBuffer(chatId, mockupBuffer, caption);
    } catch (mockupError) {
      console.warn(`Failed to build the 3D cover mockup (${mockupError.message}), falling back to the plain cover.`);
      if (book.cover_url.startsWith("data:")) {
        // A manually uploaded cover — can't be proxied through wsrv.nl (it needs a fetchable
        // URL), so send the decoded image bytes directly instead.
        const base64 = book.cover_url.split(",")[1] || "";
        sendResult = await sendPhotoBuffer(chatId, Buffer.from(base64, "base64"), caption);
      } else {
        sendResult = await telegramPost("sendPhoto", {
          chat_id: chatId,
          photo: paddedCoverUrl(book.cover_url),
          caption,
          parse_mode: "HTML",
        });
      }
    }
  } else {
    sendResult = await telegramPost("sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML" });
  }
  return sendResult && sendResult.result ? sendResult.result.message_id : null;
}

// First tries passing the URL directly (fastest, and enough for most cases since Telegram
// is the one fetching the file). If Telegram rejects the URL — usually because the file is
// bigger than the 20 MB limit allowed for the URL method, or the URL needs headers/redirects
// Telegram doesn't support directly — it automatically falls back to downloading the file here
// and then uploading it as an actual file (multipart), which supports up to 50 MB via direct upload.
async function sendBookFile(book, chatId) {
  const BOT_TOKEN = getBotToken();

  if (book.download_url.startsWith("data:")) {
    // Manually uploaded file, small enough to have been embedded as base64 — decode and
    // upload directly, no URL to fetch.
    const match = book.download_url.match(/^data:([^;]+);base64,(.+)$/s);
    const mime = match ? match[1] : "application/octet-stream";
    const base64 = match ? match[2] : book.download_url.split(",")[1] || "";
    const buffer = Buffer.from(base64, "base64");
    const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(`File size (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds the bot's upload limit (50 MB).`);
    }
    const ext = mime.includes("epub") ? ".epub" : ".pdf";
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([buffer], { type: mime }), `book${ext}`);
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form,
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.description || "Failed to upload the manually provided file.");
    return;
  }

  try {
    await telegramPost("sendDocument", { chat_id: chatId, document: book.download_url });
    return;
  } catch (urlError) {
    console.warn(`Failed to send the URL directly (${urlError.message}), downloading then uploading...`);
  }

  const fileRes = await fetch(book.download_url);
  if (!fileRes.ok) {
    throw new Error(`Failed to download the file from the source (HTTP ${fileRes.status}).`);
  }

  const contentLength = Number(fileRes.headers.get("content-length") || 0);
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // direct upload limit for regular Telegram bots
  if (contentLength && contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File size (${(contentLength / 1024 / 1024).toFixed(1)} MB) exceeds the bot's upload limit (50 MB).`
    );
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const ext = book.download_url.toLowerCase().endsWith(".pdf") ? ".pdf" : ".epub";
  const filename = `book${ext}`;

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([arrayBuffer]), filename);

  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await r.json();
  if (!data.ok) {
    throw new Error(data.description || "Failed to upload the file directly after downloading it as well.");
  }
}

async function sendToOneChannel(book, publishCoverOnlyIfNoFile, chatId) {
  if (!book.download_url) {
    if (!publishCoverOnlyIfNoFile) {
      return { status: "skipped", message: "No downloadable file available, nothing was published." };
    }
    const messageId = await sendCoverAndCaption(book, chatId);
    return { status: "cover_only", message: `Published cover and info only for: ${book.title}`, messageId };
  }
  const messageId = await sendCoverAndCaption(book, chatId);
  await sendBookFile(book, chatId);
  return { status: "published", message: `Published: ${book.title}`, messageId };
}

// channelIds: the channel *ids* the publisher picked in the UI (see lib/channels.js), not
// raw Telegram chat ids — resolveChatIds() turns those into actual chat_id(s) to send to,
// falling back through category → default → "every configured channel" when nothing was
// explicitly picked (see channels.js for the full fallback chain). Publishes to every
// resolved channel; if at least one succeeds this returns normally (with a per-channel
// breakdown), and only throws when EVERY channel failed — so existing retry/"mark
// failed" logic in the scheduler and publish queue behaves exactly as it did when there
// was only ever one channel to fail on.
async function sendBook(book, publishCoverOnlyIfNoFile, channelIds) {
  const targets = resolveChatIds(channelIds, book.category);
  if (!targets.length) {
    throw new Error(
      "No Telegram channel is configured — set CHANNEL_ID (or TELEGRAM_CHANNELS) as an environment variable in Netlify."
    );
  }

  const perChannel = [];
  for (const chatId of targets) {
    try {
      const result = await sendToOneChannel(book, publishCoverOnlyIfNoFile, chatId);
      perChannel.push({ chatId, ...result });
    } catch (e) {
      console.error(`Failed to publish to channel ${chatId}:`, e.message);
      perChannel.push({ chatId, status: "failed", error: e.message });
    }
  }

  const succeeded = perChannel.filter((r) => r.status !== "failed");
  const failed = perChannel.filter((r) => r.status === "failed");

  if (!succeeded.length) {
    const detail = failed.map((f) => `${f.chatId}: ${f.error}`).join(" | ");
    throw new Error(targets.length > 1 ? `Failed on all ${targets.length} channels — ${detail}` : failed[0].error);
  }

  const status = succeeded.every((r) => r.status === "cover_only")
    ? "cover_only"
    : succeeded.every((r) => r.status === "skipped")
    ? "skipped"
    : "published";

  let message;
  if (targets.length === 1) {
    message = succeeded[0].message;
  } else if (failed.length) {
    message = `Published to ${succeeded.length}/${targets.length} channel(s). Failed: ${failed
      .map((f) => f.chatId)
      .join(", ")}.`;
  } else {
    message = `Published to ${succeeded.length} channel(s).`;
  }

  // Every successfully-posted channel with a real messageId (i.e. not "skipped" — those
  // have nothing to track) becomes a post to check view counts on later, via
  // lib/telegramViews.js + the refresh-views cron job. publishLog.js stores this array
  // alongside the book so /api/stats can add up views per book (and across channels).
  const posts = succeeded
    .filter((r) => r.messageId)
    .map((r) => ({ chatId: r.chatId, messageId: r.messageId }));

  return { status, message, channels: perChannel, posts };
}

module.exports = { sendBook };
