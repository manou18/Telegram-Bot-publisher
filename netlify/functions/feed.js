// Public RSS/Atom feed of every book this app has published — for people who'd rather
// follow new books in their feed reader than in the Telegram channel itself.
//
// Deliberately NOT behind requireAuth (unlike every other function here): a feed reader
// can't send the X-Site-Password header, and the content is exactly what's already
// sitting in the public Telegram channel(s) this app publishes to — so there's nothing
// this endpoint exposes that isn't already public. If that's ever not true for your
// setup (e.g. private channels), set FEED_ENABLED=false to turn the endpoint off.
//
// GET /api/feed            -> RSS 2.0 (default, widest reader support)
// GET /api/feed?format=atom -> Atom 1.0
// GET /api/feed?limit=20    -> cap the number of items (default 50, max 200)

const { listPublished, getTotalViews, getTotalReactions, getTotalComments } = require("../lib/publishLog");

const FEED_TITLE = process.env.FEED_TITLE || "Book Index — الكتب المنشورة";
const FEED_DESCRIPTION = process.env.FEED_DESCRIPTION || "آخر الكتب التي تم نشرها عبر Book Index.";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function guessMime(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes(".epub")) return "application/epub+zip";
  if (lower.includes(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function siteOrigin(event) {
  const headers = event.headers || {};
  const host = headers["x-forwarded-host"] || headers.host;
  const proto = headers["x-forwarded-proto"] || "https";
  return host ? `${proto}://${host}` : "";
}

function itemDescription(book) {
  // The whole point of this feed (vs. the Telegram caption) is that nothing needs to be
  // truncated or offloaded to a Telegra.ph page — XML has no 1024/4096-char ceiling, so
  // the full description just goes straight in.
  const parts = [];
  if (book.author) parts.push(`بقلم: ${book.author}`);
  const engagement = [];
  const views = getTotalViews(book);
  const reactions = getTotalReactions(book);
  const comments = getTotalComments(book);
  if (views > 0) engagement.push(`👁 ${views.toLocaleString("en")}`);
  if (reactions > 0) engagement.push(`❤️ ${reactions.toLocaleString("en")}`);
  if (comments > 0) engagement.push(`💬 ${comments.toLocaleString("en")}`);
  if (engagement.length) parts.push(engagement.join(" · "));
  if (book.description) parts.push(book.description);
  return parts.join("\n\n");
}

function buildRss(items, feedUrl, origin) {
  const rssItems = items
    .map((b) => {
      const link = b.download_url || origin || "";
      const pubDate = b.publishedAt ? new Date(b.publishedAt).toUTCString() : new Date().toUTCString();
      const enclosure = b.download_url
        ? `\n      <enclosure url="${escapeXml(b.download_url)}" length="0" type="${guessMime(b.download_url)}" />`
        : "";
      const thumbnail = b.cover_url ? `\n      <media:thumbnail url="${escapeXml(b.cover_url)}" />` : "";
      const categoryTag = b.category ? `\n      <category>${escapeXml(b.category)}</category>` : "";
      return `    <item>
      <title>${escapeXml(b.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(b.key)}</guid>
      <pubDate>${pubDate}</pubDate>${b.author ? `\n      <dc:creator>${escapeXml(b.author)}</dc:creator>` : ""}${categoryTag}
      <description><![CDATA[${itemDescription(b)}]]></description>${thumbnail}${enclosure}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(origin || feedUrl)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>ar</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>
`;
}

function buildAtom(items, feedUrl, origin) {
  const updated = items.length && items[0].publishedAt ? new Date(items[0].publishedAt).toISOString() : new Date().toISOString();
  const entries = items
    .map((b) => {
      const link = b.download_url || origin || "";
      const entryUpdated = b.publishedAt ? new Date(b.publishedAt).toISOString() : updated;
      return `  <entry>
    <title>${escapeXml(b.title)}</title>
    <link href="${escapeXml(link)}" />
    <id>urn:book-index:${escapeXml(b.key)}</id>
    <updated>${entryUpdated}</updated>${b.author ? `\n    <author><name>${escapeXml(b.author)}</name></author>` : ""}
    <summary type="html"><![CDATA[${itemDescription(b)}]]></summary>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_DESCRIPTION)}</subtitle>
  <link href="${escapeXml(origin || feedUrl)}" />
  <link href="${escapeXml(feedUrl)}" rel="self" />
  <id>urn:book-index:feed</id>
  <updated>${updated}</updated>
${entries}
</feed>
`;
}

exports.handler = async (event) => {
  try {
    if (process.env.FEED_ENABLED === "false") {
      return { statusCode: 404, body: "Feed disabled" };
    }

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const params = event.queryStringParameters || {};
    const format = (params.format || "rss").toLowerCase() === "atom" ? "atom" : "rss";
    const requestedLimit = parseInt(params.limit, 10);
    const limit = Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT, MAX_LIMIT);

    const published = await listPublished(event);
    const items = published
      .filter((b) => b.title)
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, limit);

    const origin = siteOrigin(event);
    const feedUrl = `${origin}/api/feed${format === "atom" ? "?format=atom" : ""}`;
    const body = format === "atom" ? buildAtom(items, feedUrl, origin) : buildRss(items, feedUrl, origin);
    const contentType = format === "atom" ? "application/atom+xml; charset=utf-8" : "application/rss+xml; charset=utf-8";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
      },
      body,
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
