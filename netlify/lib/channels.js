// Multi-channel publishing destinations. Historically the whole app had exactly one
// Telegram destination, read from the CHANNEL_ID environment variable. This module lets
// the site owner configure several channels instead (via the TELEGRAM_CHANNELS env var)
// and lets the publisher pick, per book/schedule/queue-item, which one(s) it should go to.
//
// TELEGRAM_CHANNELS is a JSON array, e.g.:
// [
//   {"id":"fiction",    "name":"📖 Fiction",     "chat_id":"@my_fiction_channel",    "categories":["fiction","romance"], "default":true},
//   {"id":"nonfiction", "name":"📚 Non-fiction", "chat_id":"@my_nonfiction_channel", "categories":["history","science"]}
// ]
// - id: short internal identifier this app uses to refer to the channel (sent by the
//   frontend, stored on schedule/queue records). Any string is fine as long as it's
//   unique; falls back to chat_id itself if omitted.
// - name: label shown in the "Publish to" checklist in the UI.
// - chat_id: the actual Telegram destination — same format CHANNEL_ID always used
//   (e.g. "@channel_username" or a numeric chat id).
// - categories (optional): source category ids this channel is the natural home for —
//   used as a fallback when a publish request doesn't explicitly say which channel(s) to
//   use (see resolveChatIds below).
// - default (optional): true marks this as one of the channels to fall back to when
//   nothing else decides it (no explicit selection, no category match).
//
// Backward compatible: if TELEGRAM_CHANNELS isn't set, or is invalid/empty JSON, this
// falls back to a single channel built from CHANNEL_ID — the exact single-channel
// behavior this app had before, so existing deployments keep working unchanged.

let cachedChannels = null;
let cachedRaw; // detects an env var change across warm invocations

function dedupe(arr) {
  return Array.from(new Set(arr));
}

function parseChannels() {
  const raw = process.env.TELEGRAM_CHANNELS;
  if (raw === cachedRaw && cachedChannels) return cachedChannels;
  cachedRaw = raw;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const seen = new Set();
        const list = parsed
          .filter((c) => c && c.chat_id)
          .map((c, i) => ({
            id: String(c.id || c.chat_id || `channel_${i + 1}`),
            name: c.name || String(c.chat_id),
            chat_id: c.chat_id,
            categories: Array.isArray(c.categories) ? c.categories.map(String) : [],
            default: !!c.default,
          }))
          .filter((c) => {
            if (seen.has(c.id)) return false; // dedupe accidental repeated ids
            seen.add(c.id);
            return true;
          });
        if (list.length) {
          cachedChannels = list;
          return cachedChannels;
        }
      }
      console.error("TELEGRAM_CHANNELS is set but is not a valid non-empty JSON array — falling back to CHANNEL_ID.");
    } catch (e) {
      console.error(`TELEGRAM_CHANNELS could not be parsed as JSON (${e.message}) — falling back to CHANNEL_ID.`);
    }
  }

  // Legacy single-channel fallback — CHANNEL_ID alone, exactly like before this feature.
  const legacy = process.env.CHANNEL_ID;
  cachedChannels = legacy
    ? [{ id: "default", name: legacy, chat_id: legacy, categories: [], default: true }]
    : [];
  return cachedChannels;
}

function getChannels() {
  return parseChannels();
}

// Resolves whatever the frontend sent (an array of channel ids the publisher checked, or
// nothing) down to the actual Telegram chat_id(s) to send to. Fallback chain:
//   1. The publisher's explicit selection (channel ids → their chat_ids).
//   2. Any channel(s) whose `categories` include this book's category.
//   3. Channel(s) flagged `default: true`.
//   4. Every configured channel (so a request with no opinion at all still publishes
//      somewhere, matching the single-channel behavior this replaces).
function resolveChatIds(selectedIds, category) {
  const channels = getChannels();
  if (!channels.length) return [];

  if (Array.isArray(selectedIds) && selectedIds.length) {
    const byId = new Map(channels.map((c) => [c.id, c]));
    const resolved = selectedIds.map((id) => byId.get(String(id))).filter(Boolean);
    if (resolved.length) return dedupe(resolved.map((c) => c.chat_id));
  }

  if (category) {
    const matched = channels.filter((c) => c.categories.includes(String(category)));
    if (matched.length) return dedupe(matched.map((c) => c.chat_id));
  }

  const defaults = channels.filter((c) => c.default);
  if (defaults.length) return dedupe(defaults.map((c) => c.chat_id));

  return dedupe(channels.map((c) => c.chat_id));
}

module.exports = { getChannels, resolveChatIds };
