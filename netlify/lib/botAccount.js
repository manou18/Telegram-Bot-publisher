// Per-user download allowance: N free downloads per calendar month (UTC) + paid credits bought
// with Telegram Stars. Stored in Netlify Blobs ("bot-accounts"), like the rest of this project.
//
// A "download" is only counted when the file was actually delivered: the allowance is reserved
// just before sending and given back if the delivery fails. Netlify Blobs has no transactions,
// so two taps in the very same instant could in theory both pass the check; the 2-second gap
// enforced in botSession.js (downloadLimit) makes that practically impossible.

const { connectLambda, getStore } = require("@netlify/blobs");
const { getFreePerMonth } = require("./botPlans");

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-09" (UTC)

function store(event) {
  connectLambda(event);
  return getStore("bot-accounts");
}

async function load(event, userId, now) {
  let rec = null;
  try {
    const raw = await store(event).get(`acct:${userId}`);
    if (raw) rec = JSON.parse(raw);
  } catch {
    rec = null;
  }
  const m = monthKey(now);
  const a = { month: m, freeUsed: 0, credits: 0, totalStars: 0, ...(rec || {}) };
  if (a.month !== m) {
    a.month = m; // new month: the free allowance starts over, paid credits carry over
    a.freeUsed = 0;
  }
  return a;
}

const save = (event, userId, a) => store(event).set(`acct:${userId}`, JSON.stringify(a));

function view(a) {
  const freeTotal = getFreePerMonth();
  return { freeTotal, freeLeft: Math.max(0, freeTotal - a.freeUsed), credits: a.credits, month: a.month };
}

async function getAccount(event, userId, now) {
  return view(await load(event, userId, now));
}

// Free allowance is used first, then paid credits. Returns { ok, kind: "free"|"credit", account }.
async function reserveDownload(event, userId) {
  const a = await load(event, userId);
  let kind = null;
  if (a.freeUsed < getFreePerMonth()) {
    a.freeUsed += 1;
    kind = "free";
  } else if (a.credits > 0) {
    a.credits -= 1;
    kind = "credit";
  }
  if (!kind) return { ok: false, account: view(a) };
  await save(event, userId, a);
  return { ok: true, kind, account: view(a) };
}

async function releaseDownload(event, userId, kind) {
  const a = await load(event, userId);
  if (kind === "free") a.freeUsed = Math.max(0, a.freeUsed - 1);
  else if (kind === "credit") a.credits += 1;
  await save(event, userId, a);
}

// Idempotent per Telegram charge id: Telegram can re-deliver the same update, and a paid
// purchase must never be credited twice. The charge record is written first (so a retry can't
// double-credit) and flagged `credited` only once the balance was really updated.
async function creditPurchase(event, { userId, chargeId, downloads, stars }) {
  const s = store(event);
  const key = `charge:${chargeId}`;
  let rec = null;
  try {
    const raw = await s.get(key);
    if (raw) rec = JSON.parse(raw);
  } catch {
    rec = null;
  }
  if (rec && rec.credited) return { duplicate: true, account: await getAccount(event, userId) };
  if (!rec) {
    rec = { userId, downloads, stars, at: Date.now(), credited: false, refunded: false };
    await s.set(key, JSON.stringify(rec));
  }
  const a = await load(event, userId);
  a.credits += downloads;
  a.totalStars += stars;
  await save(event, userId, a);
  rec.credited = true;
  await s.set(key, JSON.stringify(rec));
  return { duplicate: false, account: view(a) };
}

async function getCharge(event, chargeId) {
  try {
    const raw = await store(event).get(`charge:${chargeId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// After Telegram has refunded the Stars: flag the charge and take the credits back (never below 0).
async function markRefunded(event, chargeId) {
  const rec = await getCharge(event, chargeId);
  if (!rec) return null;
  const a = await load(event, rec.userId);
  a.credits = Math.max(0, a.credits - rec.downloads);
  await save(event, rec.userId, a);
  rec.refunded = true;
  await store(event).set(`charge:${chargeId}`, JSON.stringify(rec));
  return { record: rec, account: view(a) };
}

async function grantCredits(event, userId, n) {
  const a = await load(event, userId);
  a.credits = Math.max(0, a.credits + n);
  await save(event, userId, a);
  return view(a);
}

module.exports = { monthKey, getAccount, reserveDownload, releaseDownload, creditPurchase, getCharge, markRefunded, grantCredits };
