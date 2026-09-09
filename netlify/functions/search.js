const { searchLibGen } = require('../lib/sources');
const { getCachedData, setCachedData } = require('../lib/httpCache');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const query = params.q;
  const limit = parseInt(params.limit) || 20;

  const filters = {
    format: params.format || 'all',
    yearMin: params.yearMin || null,
    yearMax: params.yearMax || null,
    sortBy: params.sortBy || 'relevance'
  };

  if (!query) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'كلمة البحث مطلوب استلامها عبر Parameter q' })
    };
  }

  const cacheKey = `search_libgen_${query}_${JSON.stringify(filters)}_${limit}`;

  try {
    // محاولة جلب البيانات من الكاش إن وجدت
    if (typeof getCachedData === 'function') {
      const cachedResult = await getCachedData(cacheKey);
      if (cachedResult) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ results: cachedResult, cached: true })
        };
      }
    }

    // جلب البيانات من LibGen
    const results = await searchLibGen(query, filters, limit);

    // حفظ النتائج في الكاش لمدة 30 دقيقة
    if (typeof setCachedData === 'function') {
      await setCachedData(cacheKey, results, 1800);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ results, cached: false })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'حدث خطأ في السيرفر', details: error.message })
    };
  }
};
