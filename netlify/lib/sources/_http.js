// Shared low-level fetch helper for every source module in this directory — no state stored
// on the server, since Netlify (serverless) functions don't guarantee memory persists between
// calls.

// Key point: some APIs (Gutendex, sometimes Open Library) protect themselves
// via Cloudflare and reject requests without headers that look like a real browser —
// the default fetch request inside a Netlify function (no headers) used to get an
// HTML page instead of JSON, which is why the "Unexpected token '<' ... is not valid JSON"
// error used to show up for the user. fetchJson below sends headers modeled on a real
// Chrome request (including the Sec-Fetch-*/Sec-Ch-Ua set most plain scrapers skip) and
// retries automatically on transient errors (403/429/5xx) — because Cloudflare's protection
// in front of gutendex.com specifically is known to be flaky (succeeds sometimes,
// fails sometimes for the exact same request).
//
// This caps out at reducing how often the 403s happen, not eliminating them — some of
// Cloudflare's checks (TLS/JA3 fingerprinting, and especially its actual JS challenge page)
// can't be satisfied by any plain HTTP request, however well-disguised, since nothing is
// executing JavaScript to solve them. A 403 that survives every retry here just surfaces as
// an error for now rather than being solved outright.

const { cachedFetchJson } = require("../httpCache");

const RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      Referer: `${new URL(url).origin}/`,
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
    },
  });

  const contentType = r.headers.get("content-type") || "";
  if (!r.ok || !contentType.includes("json")) {
    const snippet = (await r.text()).slice(0, 200);
    console.error(
      `Request to ${url} failed — status ${r.status} — attempt ${attempt}/${MAX_ATTEMPTS} — response start: ${snippet}`
    );

    if (RETRYABLE_STATUS.has(r.status) && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 500); // simple increasing delay before retrying
      return fetchJson(url, attempt + 1);
    }

    const hint =
      r.status === 403
        ? " The source's protection (Cloudflare) appears to have rejected the request — it may be a temporary block, so try again shortly or use another source for now."
        : r.status === 429
        ? " The source is rate-limiting requests — this is expected for Google Books specifically without an API key (its keyless quota is shared by every anonymous caller on the internet, not just this app); setting GOOGLE_BOOKS_API_KEY fixes it (see README). Otherwise, try again shortly or use another source for now."
        : " Try again later or try the other source.";
    throw new Error(`Could not fetch data from the external source (status ${r.status}).${hint}`);
  }

  try {
    return await r.json();
  } catch (e) {
    // A 200 response with a "json" content-type doesn't guarantee a complete body — a
    // response cut off mid-transfer (seen from OAPEN when a query's result set is large)
    // still passes the checks above but fails to parse, surfacing as a bare "Unexpected
    // end of JSON input" if left unguarded. Retry like any other transient failure first.
    console.error(`Failed to parse JSON from ${url} — attempt ${attempt}/${MAX_ATTEMPTS}: ${e.message}`);
    if (attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 500);
      return fetchJson(url, attempt + 1);
    }
    throw new Error("The source returned an incomplete or invalid response. Try again later or try another source.");
  }
}

module.exports = { fetchJson, sleep, cachedFetchJson };
