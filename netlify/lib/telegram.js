// First tries passing the file URL directly to Telegram (lighter on the Netlify function,
// since Telegram is the one fetching the file, not us). Only when this method fails — usually
// due to file size — does it fall back to downloading it here temporarily and then uploading it
// as a file (multipart), which increases the function's execution time, so watch the timeout
// limit in Netlify's settings when publishing large books (see the limits note in the README).

function getCreds() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;
  if (!BOT_TOKEN || !CHANNEL_ID) {
    throw new Error("BOT_TOKEN or CHANNEL_ID are not set as environment variables in Netlify.");
  }
  return { BOT_TOKEN, CHANNEL_ID };
}

async function telegramPost(method, payload) {
  const { BOT_TOKEN } = getCreds();
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Call to ${method} failed`);
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

async function sendCoverAndCaption(book) {
  const { CHANNEL_ID } = getCreds();
  // Telegram's photo caption limit is 1024 characters, while a text message allows 4096,
  // so we give the description more room when there's no cover being sent as a photo.
  const maxDescLen = book.cover_url ? 500 : 1500;
  const descriptionPart = book.description
    ? `\n\n📝 ${escapeHtml(truncate(book.description, maxDescLen))}`
    : "";
  const caption = `📚 <b>${book.title}</b>\n✍️ ${book.author}\n📖 ${book.source}${descriptionPart}`;
  if (book.cover_url) {
    await telegramPost("sendPhoto", {
      chat_id: CHANNEL_ID,
      photo: book.cover_url,
      caption,
      parse_mode: "HTML",
    });
  } else {
    await telegramPost("sendMessage", { chat_id: CHANNEL_ID, text: caption, parse_mode: "HTML" });
  }
}

// First tries passing the URL directly (fastest, and enough for most cases since Telegram
// is the one fetching the file). If Telegram rejects the URL — usually because the file is
// bigger than the 20 MB limit allowed for the URL method, or the URL needs headers/redirects
// Telegram doesn't support directly — it automatically falls back to downloading the file here
// and then uploading it as an actual file (multipart), which supports up to 50 MB via direct upload.
async function sendBookFile(book) {
  const { BOT_TOKEN, CHANNEL_ID } = getCreds();

  try {
    await telegramPost("sendDocument", { chat_id: CHANNEL_ID, document: book.download_url });
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
  form.append("chat_id", CHANNEL_ID);
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

async function sendBook(book, publishCoverOnlyIfNoFile) {
  if (!book.download_url) {
    if (!publishCoverOnlyIfNoFile) {
      return { status: "skipped", message: "No downloadable file available, nothing was published." };
    }
    await sendCoverAndCaption(book);
    return { status: "cover_only", message: `Published cover and info only for: ${book.title}` };
  }
  await sendCoverAndCaption(book);
  await sendBookFile(book);
  return { status: "published", message: `Published: ${book.title}` };
}

module.exports = { sendBook };
