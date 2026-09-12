// Runs on a timer (configured in netlify.toml, not called by the frontend) and checks
// whether previously-published books' download links still work — a link that was fine
// at publish time can go dead later (the hosting source reorganizes, deletes the file,
// goes offline entirely...) with nothing in this app ever noticing on its own otherwise.
//
// Like refresh-views.js, this needs no auth check: Netlify invokes it on its own with no
// user-supplied input, and it only ever acts on links already published through the app.

const { listPublishedNeedingLinkCheck, updateLinkCheckResult } = require("../lib/publishLog");
const { notifyDeadLink } = require("../lib/adminAlert");

const BATCH_SIZE = 25;
// Spaced out rather than fired concurrently, out of courtesy to whatever hosts these
// files (the same reasoning as DELAY_BETWEEN_MS in refresh-views.js/scheduled-publish.js)
// — this batch can hit many different external hosts, not just Telegram.
const DELAY_BETWEEN_MS = 500;
const TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A link counts as "alive" on any non-error HTTP status below 400 — a redirect, or even
// a login wall, still means the URL itself resolves to something; it's 404/410/DNS
// failures/timeouts this is meant to catch, not "is this still the right file".
async function isLinkAlive(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (r.status === 405 || r.status === 501) {
      // Some file hosts don't implement HEAD at all — retry with a 1-byte ranged GET
      // instead, so we still avoid downloading the whole file just to check it exists.
      r = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: controller.signal,
      });
    }
    return r.status < 400;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async (event) => {
  try {
    const tasks = await listPublishedNeedingLinkCheck(event, BATCH_SIZE);
    let checked = 0;
    let newlyDead = 0;

    for (const task of tasks) {
      const ok = await isLinkAlive(task.download_url);
      const result = await updateLinkCheckResult(event, task.key, ok);
      checked++;
      if (result && result.justWentDead) {
        newlyDead++;
        await notifyDeadLink({
          title: task.title,
          author: task.author,
          source: task.source,
          download_url: task.download_url,
        });
      }
      await sleep(DELAY_BETWEEN_MS);
    }

    return { statusCode: 200, body: JSON.stringify({ checked, newlyDead }) };
  } catch (e) {
    console.error("check-dead-links run failed:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
