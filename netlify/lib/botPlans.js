// Pricing / quota configuration for the interactive bot. Everything here can be overridden
// from Netlify environment variables, so prices can change without touching code:
//
//   BOT_FREE_PER_MONTH  free downloads per user per calendar month (UTC). Default 3.
//   BOT_STAR_PACKS      JSON array of credit packs sold for Telegram Stars, e.g.
//                       [{"id":"p10","downloads":10,"stars":40}, ...]
//   BOT_FREE_HOSTS      comma-separated download hosts that are NEVER charged/counted.
//                       Default "gutenberg.org" (Project Gutenberg's license only allows charging
//                       for its files if you pay it a 20% royalty — see BOT_SETUP.md).
//                       Set it to an empty string to charge for everything.

const DEFAULT_PACKS = [
  { id: "p10", downloads: 10, stars: 40 },
  { id: "p30", downloads: 30, stars: 100 },
  { id: "p100", downloads: 100, stars: 300 },
];

function getFreePerMonth() {
  const n = Number(process.env.BOT_FREE_PER_MONTH);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 3;
}

function getPacks() {
  const raw = process.env.BOT_STAR_PACKS;
  if (!raw) return DEFAULT_PACKS;
  try {
    const valid = JSON.parse(raw).filter(
      (p) =>
        p && /^[A-Za-z0-9]{1,16}$/.test(String(p.id)) &&
        Number.isInteger(p.downloads) && p.downloads > 0 &&
        Number.isInteger(p.stars) && p.stars >= 1 && p.stars <= 10000 // Telegram's limit for one-time Stars invoices
    );
    return valid.length ? valid : DEFAULT_PACKS;
  } catch {
    console.error("BOT_STAR_PACKS is not valid JSON — using the default packs.");
    return DEFAULT_PACKS;
  }
}

const findPack = (id) => getPacks().find((p) => p.id === id) || null;
const payloadFor = (pack) => `pack:${pack.id}`;
function packFromPayload(payload) {
  const m = /^pack:([A-Za-z0-9]{1,16})$/.exec(payload || "");
  return m ? findPack(m[1]) : null;
}

function freeHosts() {
  const raw = process.env.BOT_FREE_HOSTS === undefined ? "gutenberg.org" : process.env.BOT_FREE_HOSTS;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// True if this download link is on a host whose files are never charged nor counted.
function isFreeUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return freeHosts().some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

module.exports = { getFreePerMonth, getPacks, findPack, payloadFor, packFromPayload, isFreeUrl };
