// Search + delivery logic for the interactive "send title + author -> get a PDF/EPUB" bot.
//
// It deliberately REUSES the legal, open-access sources already defined in sources.js
// (Project Gutenberg, Open Library / Internet Archive non-restricted items, Google Books
// public-domain volumes, OAPEN, DOAB). No shadow libraries are involved.

const { SOURCES } = require("./sources");

// ---------- text helpers (Latin + Arabic aware) ----------

function normalize(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // Arabic tashkeel + tatweel
    .replace(/[\u0300-\u036f]/g, "") // Latin diacritics
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "de", "la", "le", "el", "und", "von", "و", "في", "من", "كتاب"]);

function tokens(s) {
  return normalize(s)
    .split(" ")
    .map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t))
    .filter((t) => t && !STOPWORDS.has(t));
}

// Fraction of the query tokens that appear in the candidate (exact, or prefix for len >= 4
// so that "brontë"/"bronte" or "novel"/"novels" still line up).
function overlap(queryTokens, candTokens) {
  if (!queryTokens.length) return null;
  let hit = 0;
  for (const q of queryTokens) {
    if (candTokens.some((c) => c === q || (q.length >= 4 && c.length >= 4 && (c.startsWith(q) || q.startsWith(c))))) hit++;
  }
  return hit / queryTokens.length;
}

// ---------- English-only filter ----------

const ENGLISH_CODE = /^(en|eng|english)([-_].*)?$/i;
const isLatinScript = (s) => /\p{Script=Latin}/u.test(s) && !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(s);
const hasLatinLetters = (s) => /\p{Script=Latin}/u.test(String(s || ""));

// Every source describes language differently; this returns the declared language codes/names
// (array of strings) or null when the record doesn't say.
function declaredLanguages(sourceId, raw) {
  const toArr = (v) => (v == null ? null : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean));
  const meta = (r) => {
    const vals = (r.metadata || []).filter((m) => /^dc\.language/.test(m.key || "")).map((m) => String(m.value));
    return vals.length ? vals : null;
  };
  switch (sourceId) {
    case 1: return toArr(raw.languages);                        // Gutendex: ["en"]
    case 2: return toArr(raw.language);                         // Open Library: ["eng", "fre"]
    case 3: return toArr(raw.language);                         // archive.org: "eng" / "English"
    case 5: return toArr(raw.volumeInfo && raw.volumeInfo.language); // Google Books: "en"
    case 4:
    case 6: return meta(raw);                                   // DSpace (OAPEN / DOAB): dc.language.iso
    default: return null;
  }
}

// English if the record says so. If a record declares no language at all, we only accept it
// when its title/author are written in the Latin alphabet (so Arabic/Cyrillic/CJK never slip in).
function isEnglishBook(langs, title, author) {
  if (langs && langs.length) return langs.some((l) => ENGLISH_CODE.test(l.trim()));
  return isLatinScript(`${title} ${author}`);
}

// ---------- parsing the user's message ----------

// "Title - Author", "Title | Author", "Title by Author", "عنوان - مؤلف", or two lines.
// If no separator is found the whole text is used as the title/free-text query.
function parseQuery(text) {
  let t = String(text || "").replace(/^\/(book|search|find)(@\w+)?\s*/i, "").trim();
  const patterns = [/\r?\n+/, /\s*\|\s*/, /\s+[-–—]\s+/, /\s+by\s+/i, /\s+(?:تأليف|بقلم|للمؤلف)\s+/];
  let title = t;
  let author = "";
  for (const p of patterns) {
    const parts = t.split(p).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      title = parts[0];
      author = parts.slice(1).join(" ");
      break;
    }
  }
  return { raw: t, title, author, titleTokens: tokens(title), authorTokens: tokens(author) };
}

// Score in 0..1. Also tries the swapped order, in case the user typed "Author - Title".
function scoreCandidate(cand, q) {
  const candTitle = tokens(cand.title);
  const candAuthor = tokens(cand.author);
  if (!q.authorTokens.length) {
    return overlap(q.titleTokens, candTitle.concat(candAuthor)) || 0;
  }
  const t = overlap(q.titleTokens, candTitle) || 0;
  const a = overlap(q.authorTokens, candAuthor) || 0;
  const direct = 0.65 * t + 0.35 * a;
  const swapped = 0.65 * (overlap(q.authorTokens, candTitle) || 0) + 0.35 * (overlap(q.titleTokens, candAuthor) || 0);
  return Math.max(direct, swapped);
}

// sources.js displayLine() is "Title  —  Authors" (OAPEN may add a "no direct file" tag).
function splitDisplayLine(line) {
  const i = line.lastIndexOf("  —  ");
  const title = (i >= 0 ? line.slice(0, i) : line).replace(/\s*🔒 no direct file\s*$/, "").trim();
  const author = i >= 0 ? line.slice(i + 5).trim() : "";
  return { title, author };
}

// ---------- searching ----------

const SEARCH_SOURCES = [1, 2, 5, 3, 4, 6]; // Gutenberg, Open Library/IA, Google Books (PD), IA texts, OAPEN, DOAB
const SOURCE_TIMEOUT_MS = 15000;
const MIN_SCORE = 0.6;
const CANDIDATES_PER_SOURCE = 3;
const MAX_BUILD = 6;
const MAX_RESULTS = 5;

function clean(s) {
  return String(s || "").replace(/["()\\:]/g, " ").replace(/\s+/g, " ").trim();
}

function buildQueryFor(sourceId, q) {
  const title = clean(q.title);
  const author = clean(q.author);
  if (sourceId === 2) return `${title} ${author} language:eng`.replace(/\s+/g, " ").trim(); // Open Library field filter
  if (!author) return title;
  if (sourceId === 5) return `intitle:"${title}" inauthor:"${author}"`; // Google Books syntax
  if (sourceId === 3) return `title:(${title}) AND creator:(${author})`; // archive.org advancedsearch syntax
  return `${title} ${author}`;
}

// Gutendex takes the language as a URL parameter; sources.js lets us pass a complete URL as the
// "next page" argument, which is the least invasive way to add it.
function gutendexEnglishUrl(query) {
  return `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=en`;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Returns { results: [{ source, title, author, pdf, epub, score, sourceUrl }], failedSources: [names] }
async function searchBooks(event, q) {
  const failedSources = [];

  // 1) search every source in parallel, rank the raw hits by title/author similarity
  // BOT_DISABLED_SOURCES="4,6" removes sources (by id in sources.js) — e.g. if a source's licence
  // terms don't allow you to charge for delivering its files.
  const disabled = new Set((process.env.BOT_DISABLED_SOURCES || "").split(",").map((x) => Number(x.trim())).filter(Boolean));
  const perSource = await Promise.all(
    SEARCH_SOURCES.filter((id) => !disabled.has(id)).map(async (id) => {
      const source = SOURCES[id];
      try {
        const query = buildQueryFor(id, q);
        const data = await withTimeout(source.search(event, query, id === 1 ? gutendexEnglishUrl(query) : null), SOURCE_TIMEOUT_MS, source.name);
        return (data.results || [])
          .map((raw) => {
            const { title, author } = splitDisplayLine(source.displayLine(raw));
            return { id, source, raw, title, author, score: scoreCandidate({ title, author }, q) };
          })
          .filter((c) => isEnglishBook(declaredLanguages(id, c.raw), c.title, c.author))
          .filter((c) => c.score >= MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, CANDIDATES_PER_SOURCE);
      } catch (e) {
        console.error(`Bot search failed on ${source.name}:`, e.message);
        failedSources.push(source.name);
        return [];
      }
    })
  );

  const candidates = perSource.flat().sort((a, b) => b.score - a.score).slice(0, MAX_BUILD);

  // 2) resolve the best candidates into real download links (only ones with a PDF/EPUB survive)
  const built = await Promise.all(
    candidates.map(async (c) => {
      try {
        const book = await withTimeout(c.source.buildBook(c.raw), SOURCE_TIMEOUT_MS, c.source.name);
        const pdf = book.download_url_pdf || null;
        const epub = book.download_url_epub || null;
        if (!pdf && !epub) return null;
        if (book.language && !isEnglishBook([].concat(book.language).map(String), book.title, book.author)) return null; // archive.org says it isn't English
        return { source: book.source || c.source.name, title: book.title || c.title, author: book.author || c.author, pdf, epub, score: c.score };
      } catch (e) {
        console.error(`Bot buildBook failed on ${c.source.name}:`, e.message);
        return null;
      }
    })
  );

  // 3) de-duplicate the same book found in several sources, keeping every format we found.
  //    The key ignores word order in the author ("Austen, Jane" vs "Jane Austen").
  const merged = new Map();
  for (const b of built.filter(Boolean)) {
    const key = `${normalize(b.title)}|${tokens(b.author).sort().join(" ")}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, b);
      continue;
    }
    const best = b.score > prev.score ? b : prev;
    const other = best === b ? prev : b;
    best.pdf = best.pdf || other.pdf;
    best.epub = best.epub || other.epub;
    merged.set(key, best);
  }

  const results = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  return { results, failedSources };
}

// ---------- Telegram helpers ----------

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // regular bots: 50 MB per uploaded file
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const UA = "BookIndexBot/1.0 (open-access book finder; Telegram bot)";

function tgUrl(method) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not set.");
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function tg(method, payload) {
  const r = await fetch(tgUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

// Telegram HTML parse mode: only these three characters need escaping.
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function safeFilename(title, author, ext) {
  const base = [title, author].filter(Boolean).join(" - ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${base || "book"}.${ext}`;
}

function looksLikeFormat(buf, ext) {
  if (ext === "pdf") return buf.slice(0, 5).toString("latin1") === "%PDF-";
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // EPUB is a ZIP ("PK")
}

// Downloads the file, checks it really is a PDF/EPUB (not an HTML error/login page) and uploads
// it with a proper file name and a formatted caption. Returns { ok: true, bytes } or
// { ok: false, reason: "too_large" | "not_a_book" }.
async function sendBookDocument(chatId, book, format) {
  const url = format === "epub" ? book.epub : book.pdf;
  const ext = format === "epub" ? "epub" : "pdf";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let buf;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
    buf = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (!looksLikeFormat(buf, ext)) return { ok: false, reason: "not_a_book" };

  const form = new FormData();
  form.append("chat_id", String(chatId));
  const head = [`<b>${esc(String(book.title || "").slice(0, 200))}</b>`];
  if (book.author) head.push(`<i>${esc(String(book.author).slice(0, 150))}</i>`);
  const badge = format === "epub" ? "📘 EPUB" : "📄 PDF";
  const meta = [`📚 ${esc(String(book.source || "").slice(0, 80))}`, badge, formatBytes(buf.length)].filter(Boolean).join(" · ");
  form.append("caption", `${head.join("\n")}\n\n${meta}`);
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([buf]), safeFilename(book.title, book.author, ext));
  const r = await fetch(tgUrl("sendDocument"), { method: "POST", body: form });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Telegram sendDocument failed");
  return { ok: true, bytes: buf.length };
}

module.exports = {
  isEnglishBook, declaredLanguages, hasLatinLetters,
  normalize, tokens, parseQuery, scoreCandidate, splitDisplayLine, buildQueryFor,
  searchBooks, tg, sendBookDocument, safeFilename, looksLikeFormat, esc, formatBytes,
};
