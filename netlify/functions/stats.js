const { listPublished, getTotalViews } = require("../lib/publishLog");
const { listSaved } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");
const { listQueue, getQueueSettings } = require("../lib/publishQueue");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const [published, saved, queueRecords, queueSettings] = await Promise.all([
      listPublished(event),
      listSaved(event),
      listQueue(event),
      getQueueSettings(event),
    ]);

    const ratedBooks = published.filter((b) => b.rating);
    const averageRating = ratedBooks.length
      ? ratedBooks.reduce((sum, b) => sum + b.rating, 0) / ratedBooks.length
      : null;

    const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    ratedBooks.forEach((b) => {
      ratingBreakdown[b.rating] = (ratingBreakdown[b.rating] || 0) + 1;
    });

    const bySource = {};
    published.forEach((b) => {
      bySource[b.source] = (bySource[b.source] || 0) + 1;
    });

    // Only counts books published while browsing a specific category (books published
    // via Search/Collection/Saved have no category attached, so they're left out here
    // rather than lumped under a fake "none" bucket).
    const byCategory = {};
    published.forEach((b) => {
      if (b.category) byCategory[b.category] = (byCategory[b.category] || 0) + 1;
    });

    const recent = [...published]
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 8)
      .map((b) => ({ title: b.title, author: b.author, rating: b.rating || null, publishedAt: b.publishedAt, views: getTotalViews(b) }));

    // Telegram view counts (see lib/telegramViews.js) — filled in gradually by the
    // refresh-views cron job, not at publish time, so a freshly-published book will show
    // 0 views here until its first refresh. Only counted once a post has actually been
    // checked at least once (getTotalViews returns 0 for both "checked, 0 views" and
    // "never checked yet" — topViewed below filters the latter out by requiring > 0).
    const totalViews = published.reduce((sum, b) => sum + getTotalViews(b), 0);
    const topViewed = [...published]
      .map((b) => ({ title: b.title, author: b.author, views: getTotalViews(b) }))
      .filter((b) => b.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 8);

    // Publish Queue summary — previously invisible from this panel, so a stalled or
    // paused drip-feed queue (or one quietly piling up with "stuck" items, see
    // lib/publishQueue.js) went unnoticed unless the user happened to open the Publish
    // Queue tab itself.
    const queue = {
      total: queueRecords.length,
      stuck: queueRecords.filter((r) => r.status === "stuck").length,
      enabled: queueSettings.enabled,
      intervalMinutes: queueSettings.intervalMinutes,
      lastPublishedAt: queueSettings.lastPublishedAt,
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalPublished: published.length,
        totalSaved: saved.length,
        totalRated: ratedBooks.length,
        averageRating,
        ratingBreakdown,
        bySource,
        byCategory,
        recent,
        totalViews,
        topViewed,
        queue,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
