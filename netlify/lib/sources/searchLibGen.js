const { fetchJson } = require("./_http");

const LIBGEN_CATEGORIES = {
  1: "fiction",
  2: "sci-tech",
};

// Search: Fetch HTML page, extract MD5 hashes, then use JSON API for accurate data
async function searchLibGenSearch(event, query, pageToken) {
  // LibGen search URL (simple search)
  const searchUrl = `https://libgen.is/search.php?req=${encodeURIComponent(query)}&res=25&view=simple&phrase=1&column=def`;
  
  try {
    // 1. Fetch the search results page
    const res = await fetch(searchUrl);
    if (!res.ok) return { results: [], next: null };
    const html = await res.text();
    
    // 2. Extract book MD5 hashes using Regex
    const md5Matches = [...html.matchAll(/md5=([a-fA-F0-9]{32})/gi)];
    // Remove duplicates and limit to top 10 results to avoid rate-limiting the API
    const uniqueMd5s = [...new Set(md5Matches.map(m => m[1].toUpperCase()))].slice(0, 10);
    
    if (uniqueMd5s.length === 0) return { results: [], next: null };
    
    // 3. Fetch structured data using LibGen JSON API
    const apiUrl = `https://libgen.is/json.php?ids=${uniqueMd5s.join(',')}&fields=id,title,author,year,extension,md5,coverurl,language,descr`;
    const data = await fetch(apiUrl).then(r => r.json());
    
    // 4. Filter results to include only app-supported formats (PDF and EPUB)
    const validResults = data.filter(b => b.extension === 'pdf' || b.extension === 'epub');
    
    return { results: validResults, next: null };
  } catch (err) {
    console.error("LibGen Search Error:", err);
    return { results: [], next: null };
  }
}

// Browse categories: LibGen lacks a simple category browsing API, returning an empty list to prevent errors
async function searchLibGenBrowseCategory(event, category, pageToken) {
  return { results: [], next: null };
}

// Append file extension to the display line for user clarity in search results
function searchLibGenDisplayLine(book) {
  return `${book.title} [${book.extension.toUpperCase()}]  —  ${book.author}`;
}

// Build book: Extract the direct download link from the library.lol mirror page
async function searchLibGenBuildBook(book) {
  // Mirror download page URL
  const mirrorUrl = `https://library.lol/main/${book.md5}`;
  let directLink = null;
  
  try {
    const res = await fetch(mirrorUrl);
    const html = await res.text();
    
    // Extract the direct download link from the "GET" anchor tag
    const match = html.match(/<a href="([^"]+)">GET<\/a>/i);
    if (match) {
      directLink = match[1];
    }
  } catch (err) {
    console.error("LibGen Build Error:", err);
  }

  return {
    title: book.title,
    author: book.author,
    cover_url: book.coverurl ? `https://libgen.is/covers/${book.coverurl}` : null,
    download_url: mirrorUrl, // Fallback/reference URL
    // Assign the direct link based on file format so the bot can download and deliver it
    download_url_pdf: book.extension === "pdf" ? directLink : null,
    download_url_epub: book.extension === "epub" ? directLink : null,
    description: book.descr || null,
    language: book.language || "eng",
    source: "Library Genesis",
  };
}

module.exports = {
  name: "searchLibGen",
  categories: LIBGEN_CATEGORIES,
  browseCategory: searchLibGenBrowseCategory,
  search: searchLibGenSearch,
  displayLine: searchLibGenDisplayLine,
  buildBook: searchLibGenBuildBook,
};
