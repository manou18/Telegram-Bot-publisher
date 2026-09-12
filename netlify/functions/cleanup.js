// Runs on a timer (configured in netlify.toml, not called by the frontend) and prunes old
// data out of Netlify Blobs so this app stays comfortably inside the free tier's storage
// limits over time. There's no X-Site-Password check here for the same reason as
// scheduled-publish.js — Netlify triggers this on its own, and it only ever deletes data
// that's already past its own retention window, never anything a user is actively using.
//
// Deliberately does NOT touch published-books: unlike the two stores below, its records
// never carry a large payload (just title/author/source/rating/date — a few hundred bytes
// each), and its whole purpose — warning you if you try to republish the same book — is a
// long-term one. Deleting old entries there would eventually let a book get "duplicate"-
// published again with no real storage benefit to show for it, so that store is left to
// grow indefinitely on purpose. (cleanupOldPublished() still exists in publishLog.js if a
// different retention policy is ever wanted — it's just not called from here.)
//
// What IS cleaned, and why each has its own window:
//  - scheduled-books (resolved records only, never "pending"): kept for a month. By the
//    time a record gets here, markScheduledResult() has already stripped its heavy
//    payload on both success and failure, so this just clears out old small history
//    entries.
//  - http-cache (short-lived browse/search response cache): kept for about a day, since
//    every entry is already treated as useless after a few hours (see httpCache.js) — a
//    month-long retention here would still let it grow forever for no benefit.
//
// login-attempts is deliberately left alone too: entries with no lockout are never given
// a timestamp to age off of (see auth.js), and the store is small/self-limited enough that
// it isn't worth changing that security-relevant code just to clean it up.
const { cleanupOldScheduled } = require("../lib/scheduledBooks");
const { cleanupOldCache } = require("../lib/httpCache");

exports.handler = async (event) => {
  const results = {};
  try {
    results.scheduled_removed = await cleanupOldScheduled(event);
  } catch (e) {
    console.error("cleanup: scheduled-books failed:", e.message);
    results.scheduled_error = e.message;
  }
  try {
    results.cache_removed = await cleanupOldCache(event);
  } catch (e) {
    console.error("cleanup: http-cache failed:", e.message);
    results.cache_error = e.message;
  }
  return { statusCode: 200, body: JSON.stringify(results) };
};
