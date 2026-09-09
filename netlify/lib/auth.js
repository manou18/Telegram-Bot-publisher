// Every /api/* function is public once deployed (Netlify serves the site to anyone with
// the URL), and this tool publishes directly to a real Telegram channel — so each function
// requires a shared password sent as the X-Site-Password header. There's no server-side
// session (no persistent server at all, per the README), so this simple shared-secret check
// is the lightest option that doesn't need a paid Netlify plan (unlike site-wide password
// protection) or a database (unlike real user accounts).
//
// On top of the password check itself: after 3 wrong attempts from the same client, further
// attempts are blocked for 1 hour, to slow down anyone trying to guess the password.
// Attempts are tracked in Netlify Blobs (the same persistent store used elsewhere in this
// app) keyed by client IP, since that's the only thing that reasonably identifies "the same
// caller" across requests without any login/session system.

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function getClientId(event) {
  const headers = event.headers || {};
  const forwardedFor = headers["x-forwarded-for"];
  const ip =
    headers["x-nf-client-connection-ip"] ||
    headers["client-ip"] ||
    (forwardedFor ? forwardedFor.split(",")[0].trim() : null);
  // Falling back to a single shared bucket if we truly can't tell clients apart is safer
  // than skipping the rate limit entirely — worst case, unrelated users share one lockout.
  return ip || "unknown";
}

function getAttemptsStore(event) {
  connectLambda(event);
  return getStore("login-attempts");
}

function keyForClient(clientId) {
  return crypto.createHash("sha256").update(clientId).digest("hex");
}

async function getAttempts(event, clientId) {
  const store = getAttemptsStore(event);
  const raw = await store.get(keyForClient(clientId));
  if (!raw) return { count: 0, lockedUntil: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

async function saveAttempts(event, clientId, record) {
  const store = getAttemptsStore(event);
  await store.set(keyForClient(clientId), JSON.stringify(record));
}

async function clearAttempts(event, clientId) {
  const store = getAttemptsStore(event);
  await store.delete(keyForClient(clientId));
}

function minutesLeft(lockedUntil) {
  return Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
}

async function requireAuth(event) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "SITE_PASSWORD is not set as an environment variable in Netlify. Set it (Site settings → Environment variables) and redeploy before using this app.",
      }),
    };
  }

  const clientId = getClientId(event);
  let attempts = { count: 0, lockedUntil: null };
  try {
    attempts = await getAttempts(event, clientId);
  } catch (e) {
    console.error("Failed to read login attempts (allowing through):", e.message);
  }

  const now = Date.now();
  const stillLocked = attempts.lockedUntil && now < attempts.lockedUntil;
  if (stillLocked) {
    const mins = minutesLeft(attempts.lockedUntil);
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      }),
    };
  }

  const headers = event.headers || {};
  const provided = headers["x-site-password"] || headers["X-Site-Password"];

  if (provided === expected) {
    if (attempts.count > 0 || attempts.lockedUntil) {
      try {
        await clearAttempts(event, clientId);
      } catch (e) {
        console.error("Failed to clear login attempts:", e.message);
      }
    }
    return null; // authorized
  }

  // Wrong password. A previous lockout that has since expired starts the count over at 1
  // rather than compounding onto the old total.
  const priorCount = attempts.lockedUntil && now >= attempts.lockedUntil ? 0 : attempts.count;
  const count = priorCount + 1;
  const record = { count, lockedUntil: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null };
  try {
    await saveAttempts(event, clientId, record);
  } catch (e) {
    console.error("Failed to save login attempts:", e.message);
  }

  if (record.lockedUntil) {
    return {
      statusCode: 429,
      body: JSON.stringify({ error: "Too many incorrect attempts. Try again in 60 minutes." }),
    };
  }

  const remaining = MAX_ATTEMPTS - count;
  return {
    statusCode: 401,
    body: JSON.stringify({
      error: `Incorrect password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a 1-hour lockout.`,
    }),
  };
}

module.exports = { requireAuth };
