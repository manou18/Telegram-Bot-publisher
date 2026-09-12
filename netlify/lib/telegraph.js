// Publishes a book's full description to a Telegra.ph page, so telegram.js can link to
// the complete text instead of cutting it off mid-sentence when it's longer than
// Telegram's own limits (1024 chars for a photo caption, 4096 for a text message —
// see truncate()/sendCoverAndCaption() in telegram.js).
//
// Telegra.ph doesn't need a real account/login: "creating an account" just gets you an
// access_token to create pages with, and the pages themselves stay publicly viewable
// forever regardless of which throwaway account created them. So there's nothing worth
// persisting in Blobs here — we create one account lazily on first use and cache the
// token in memory, which is enough to avoid re-creating it on every single publish
// within the same warm function instance (a fresh one on the next cold start is harmless
// and free).

let cachedAccessToken = null;

async function telegraphCall(method, payload) {
  const r = await fetch(`https://api.telegra.ph/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || `Telegra.ph call to ${method} failed`);
  return data.result;
}

async function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  const result = await telegraphCall("createAccount", {
    short_name: "BookIndex",
    author_name: "Book Index",
  });
  cachedAccessToken = result.access_token;
  return cachedAccessToken;
}

// Telegra.ph's content isn't plain text/HTML — it's an array of DOM-like "Node" objects
// (tag/children). Splitting on blank lines and wrapping each chunk as a <p> is enough to
// keep a plain-text description readable (paragraph breaks preserved, nothing fancier).
function toParagraphNodes(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ tag: "p", children: [p] }));
}

// Returns the URL of a new Telegra.ph page containing the book's full description, or
// null if there's no description to publish. Throws on API failure — callers should
// treat that as "fall back to truncating", not as a fatal error for the whole publish.
async function createDescriptionPage(book) {
  const content = toParagraphNodes(book.description || "");
  if (!content.length) return null;

  const accessToken = await getAccessToken();
  // Telegra.ph caps title at 256 chars and author_name at 128 — book titles/authors
  // should never realistically hit that, but truncate defensively rather than 400.
  const title = String(book.title || "Book description").slice(0, 256);
  const authorName = book.author ? String(book.author).slice(0, 128) : undefined;

  const result = await telegraphCall("createPage", {
    access_token: accessToken,
    title,
    author_name: authorName,
    content,
    return_content: false,
  });
  return result.url;
}

module.exports = { createDescriptionPage };
