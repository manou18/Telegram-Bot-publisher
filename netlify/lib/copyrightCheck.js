// A best-effort, free "is this likely public domain / safe to publish" advisory check for
// manually entered books. IMPORTANT: this is NOT a legal determination. There is no free
// (or paid) API that can definitively say "this exact file is or isn't copyrighted" — that
// depends on facts (publication country/date, renewal history, the specific license on the
// specific copy) that no catalog fully captures. What we CAN do is check a title/author
// against a few well-known, already-trusted-in-this-app catalogs and surface what they know:
//   - Project Gutenberg only hosts books it has confirmed are public domain in the US, so a
//     match there is a strong positive signal.
//   - Google Books exposes accessInfo.publicDomain / accessViewStatus for the exact edition
//     it has (same field this app already relies on for its Google Books source), plus
//     saleInfo.saleability, which is a strong signal the other way (still commercially sold).
//   - Open Library exposes whether a full public scan is on file (public_scan_b) versus only
//     a lending copy.
// The result is always presented as an advisory with a clear disclaimer, never a hard block —
// the publish decision (and responsibility) stays with the person doing the publishing.

const { fetchJson } = require("./sources");
const { cachedFetchJson } = require("./httpCache");

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looselyMatches(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function checkGutenberg(event, title, author) {
  try {
    const query = author ? `${title} ${author}` : title;
    const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
    const data = await cachedFetchJson(event, url, fetchJson);
    const results = data.results || [];
    const match = results.find((b) => looselyMatches(b.title, title));
    return {
      source: "Project Gutenberg",
      checked: true,
      match: !!match,
      publicDomain: !!match,
      note: match
        ? "Found in Project Gutenberg — it only hosts books confirmed public domain in the US."
        : "No match found in Project Gutenberg's catalog.",
    };
  } catch (e) {
    return { source: "Project Gutenberg", checked: false, match: false, note: `Could not check (${e.message}).` };
  }
}

async function checkGoogleBooks(event, title, author) {
  try {
    const q = author ? `intitle:${title} inauthor:${author}` : `intitle:${title}`;
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`;
    const data = await cachedFetchJson(event, url, fetchJson);
    const items = data.items || [];
    const top = items.find((it) => looselyMatches(it.volumeInfo && it.volumeInfo.title, title)) || items[0];
    if (!top) {
      return { source: "Google Books", checked: true, match: false, note: "No match found on Google Books." };
    }
    const access = top.accessInfo || {};
    const sale = top.saleInfo || {};
    const isPublicDomain = access.publicDomain === true || access.accessViewStatus === "FULL_PUBLIC_DOMAIN";
    const forSale = sale.saleability === "FOR_SALE";
    let note;
    if (isPublicDomain) note = "Google Books marks this edition as public domain.";
    else if (forSale) note = "Google Books shows this title as currently for sale — likely still under copyright.";
    else note = "Google Books has a match but doesn't mark it public domain — treat as possibly copyrighted.";
    return { source: "Google Books", checked: true, match: true, publicDomain: isPublicDomain, forSale, note };
  } catch (e) {
    return { source: "Google Books", checked: false, match: false, note: `Could not check (${e.message}).` };
  }
}

async function checkOpenLibrary(event, title, author) {
  try {
    const params = new URLSearchParams({ title, limit: "5" });
    if (author) params.set("author", author);
    const url = `https://openlibrary.org/search.json?${params.toString()}`;
    const data = await cachedFetchJson(event, url, fetchJson);
    const docs = data.docs || [];
    const top = docs.find((d) => looselyMatches(d.title, title)) || docs[0];
    if (!top) {
      return { source: "Open Library", checked: true, match: false, note: "No match found on Open Library." };
    }
    const publicScan = top.public_scan_b === true;
    const hasIa = Array.isArray(top.ia) && top.ia.length > 0;
    let note;
    if (publicScan) note = "Open Library shows a full public scan on file (Internet Archive) — a good sign it's public domain or openly licensed.";
    else if (hasIa) note = "Open Library links an Internet Archive copy, but it may be lending-only rather than freely downloadable — worth verifying.";
    else note = "Open Library has a match with no public full-text scan on record.";
    return { source: "Open Library", checked: true, match: true, publicScan, note };
  } catch (e) {
    return { source: "Open Library", checked: false, match: false, note: `Could not check (${e.message}).` };
  }
}

async function checkCopyrightStatus(event, title, author) {
  const [gutenberg, googleBooks, openLibrary] = await Promise.all([
    checkGutenberg(event, title, author),
    checkGoogleBooks(event, title, author),
    checkOpenLibrary(event, title, author),
  ]);
  const signals = [gutenberg, googleBooks, openLibrary];

  let verdict = "uncertain";
  let summary;
  if (gutenberg.match || googleBooks.publicDomain || openLibrary.publicScan) {
    verdict = "likely_public_domain";
    summary = "Good signs this book is public domain or openly licensed — but double-check that the specific edition/file you have matches what was found here.";
  } else if (googleBooks.forSale || (googleBooks.match && !googleBooks.publicDomain)) {
    verdict = "likely_copyrighted";
    summary = "This title appears to be commercially published or still under copyright — publishing it without permission would likely infringe copyright.";
  } else if (!gutenberg.match && !googleBooks.match && !openLibrary.match) {
    verdict = "no_match";
    summary = "No match found in any of the catalogs checked. That doesn't confirm the book is public domain — only that we couldn't verify it either way.";
  } else {
    summary = "Mixed or inconclusive signals — review the notes below before publishing.";
  }

  return {
    verdict,
    summary,
    signals,
    disclaimer:
      "This is an automated, best-effort check against a few open catalogs (Project Gutenberg, Google Books, Open Library) — it is not legal advice and not a guarantee. It can't verify the exact file you're publishing, only whether a matching title/author is known to be public domain elsewhere. When in doubt, don't publish, or consult a legal professional. The decision — and the responsibility — is yours.",
  };
}

module.exports = { checkCopyrightStatus };
