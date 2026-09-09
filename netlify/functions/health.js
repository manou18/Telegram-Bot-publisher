const { requireAuth } = require("../lib/auth");

// Cheap, source-specific "is it up right now" probes. Deliberately NOT the same request
// path as Browse/Search (no http-cache, no retry-with-backoff) — the whole point here is
// to see each source's real live status, not a resilient result. Requests run in parallel,
// each with its own short timeout, so one slow/hanging source doesn't stall the check.

const TIMEOUT_MS = 6000;

const PROBES = [
  { id: "1", name: "Project Gutenberg (Gutendex)", url: "https://gutendex.com/books?search=test" },
  { id: "2", name: "Open Library / Internet Archive", url: "https://openlibrary.org/subjects/fiction.json?limit=1" },
  { id: "3", name: "Internet Archive — Education & Teaching", url: "https://archive.org/advancedsearch.php?q=education&rows=1&output=json" },
  { id: "4", name: "OAPEN", url: "https://library.oapen.org/rest/search?query=education&limit=1" },
  { id: "5", name: "Google Books", url: "https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1" },
  { id: "6", name: "DOAB", url: "https://directory.doabooks.org/rest/search?query=education&limit=1" },
];

async function probe(source) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
    });
    return { id: source.id, name: source.name, ok: r.ok, status: r.status, ms: Date.now() - started };
  } catch (e) {
    return {
      id: source.id,
      name: source.name,
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: e.name === "AbortError" ? `Timed out after ${TIMEOUT_MS}ms` : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    const sources = await Promise.all(PROBES.map(probe));
    const healthy = sources.filter((s) => s.ok).length;

    return {
      statusCode: 200,
      body: JSON.stringify({
        checkedAt: new Date().toISOString(),
        healthy,
        total: sources.length,
        sources,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
