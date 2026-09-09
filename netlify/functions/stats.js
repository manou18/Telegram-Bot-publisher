const { listPublished } = require("../lib/publishLog");
const { listSaved } = require("../lib/savedBooks");
const { requireAuth } = require("../lib/auth");

exports.handler = async (event) => {
  try {
    const authError = await requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const [published, saved] = await Promise.all([listPublished(event), listSaved(event)]);

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
      .map((b) => ({ title: b.title, author: b.author, rating: b.rating || null, publishedAt: b.publishedAt }));

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
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
