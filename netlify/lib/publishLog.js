// Records every book that actually gets published so we can warn the user if they try to
// publish the same book again. We use Netlify Blobs because it's the only storage available
// to Netlify functions that persists between calls (unlike regular memory, which is cleared
// on each separate function invocation).

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

// Fixed-length key per book: we use the download URL if it exists (since it's the most
// specific to a particular edition), otherwise we combine title, author, and source as a
// fallback for a book published with just its cover, no file.
function keyFor(book) {
  const raw = book.download_url || `${book.source}::${book.title}::${book.author}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getPublishStore(event) {
  connectLambda(event);
  return getStore("published-books");
}

async function checkPublished(event, book) {
  const store = getPublishStore(event);
  const raw = await store.get(keyFor(book));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function recordPublished(event, book) {
  const store = getPublishStore(event);
  await store.set(
    keyFor(book),
    JSON.stringify({
      title: book.title,
      author: book.author,
      source: book.source,
      publishedAt: new Date().toISOString(),
    })
  );
}

module.exports = { checkPublished, recordPublished };
