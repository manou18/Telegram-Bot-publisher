const axios = require('axios');

// قائمة المرايا لـ LibGen
const LIBGEN_MIRRORS = [
  'https://libgen.is',
  'https://libgen.rs',
  'https://libgen.st'
];

/**
 * تحويل حجم الملف لنمط مقروء
 */
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * البحث في LibGen مع الفلترة والترتيب
 */
async function searchLibGen(query, filters = {}, limit = 20) {
  try {
    const mirror = LIBGEN_MIRRORS[0];
    
    // 1. البحث عن IDs
    const searchUrl = `${mirror}/search.php?req=${encodeURIComponent(query)}&column=def&sort=def&sortmode=ASC`;
    const searchResponse = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const idMatches = searchResponse.data.match(/id=([0-9]+)/g);
    if (!idMatches || idMatches.length === 0) {
      return [];
    }

    const ids = Array.from(new Set(idMatches.map(m => m.replace('id=', '')))).slice(0, 50);

    // 2. جلب تفاصيل البيانات عبر JSON API
    const jsonUrl = `${mirror}/json.php?ids=${ids.join(',')}&fields=id,title,author,year,extension,filesize,md5,coverurl,publisher`;
    const detailsResponse = await axios.get(jsonUrl, { timeout: 10000 });

    if (!detailsResponse.data || !Array.isArray(detailsResponse.data)) {
      return [];
    }

    // 3. هيكلة البيانات
    let books = detailsResponse.data.map(book => ({
      id: `libgen_${book.id}`,
      source: 'libgen',
      title: book.title || 'عنوان غير معروف',
      author: book.author || 'مؤلف غير معروف',
      year: parseInt(book.year) || null,
      publisher: book.publisher || 'غير محدد',
      format: (book.extension || 'pdf').toLowerCase(),
      size: formatBytes(parseInt(book.filesize) || 0),
      rawSizeBytes: parseInt(book.filesize) || 0,
      cover: book.coverurl ? `${mirror}/covers/${book.coverurl}` : null,
      downloadUrl: `${mirror}/get.php?md5=${book.md5}`,
      md5: book.md5
    }));

    // 4. تطبيق الفلاتر
    if (filters.format && filters.format !== 'all') {
      const targetFormat = filters.format.toLowerCase();
      books = books.filter(b => b.format === targetFormat);
    }

    if (filters.yearMin) {
      const minYr = parseInt(filters.yearMin);
      books = books.filter(b => b.year && b.year >= minYr);
    }

    if (filters.yearMax) {
      const maxYr = parseInt(filters.yearMax);
      books = books.filter(b => b.year && b.year <= maxYr);
    }

    // 5. الترتيب
    if (filters.sortBy === 'year_desc') {
      books.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (filters.sortBy === 'year_asc') {
      books.sort((a, b) => (a.year || 0) - (b.year || 0));
    } else if (filters.sortBy === 'size_desc') {
      books.sort((a, b) => b.rawSizeBytes - a.rawSizeBytes);
    } else if (filters.sortBy === 'size_asc') {
      books.sort((a, b) => a.rawSizeBytes - b.rawSizeBytes);
    }

    return books.slice(0, limit);
  } catch (error) {
    console.error('LibGen Search Error:', error.message);
    return [];
  }
}

module.exports = {
  searchLibGen,
  LIBGEN_MIRRORS
};
