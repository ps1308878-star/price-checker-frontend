// api/search.js
// Vercel serverless endpoint: /api/search?query=your+query
// Reads SERP API key from env: SERPAPI_KEY or SERP_API_KEY
// Falls back to FakeStore API if SerpApi missing or returns no results.

const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes cache
const cache = new Map();

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parsePrice(priceStr) {
  if (priceStr == null) return null;
  const cleaned = String(priceStr).replace(/[^\d.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeSerpItem(item) {
  const title = item.title || item.product_title || item.name || '';
  const thumbnail = item.thumbnail || item.thumbnail_link || item.image || (item.inline_images && item.inline_images[0]) || null;
  const link = item.link || item.product_link || item.source || item.result_link || null;
  const priceRaw = item.extracted_price || item.price || (item.offers && item.offers[0] && (item.offers[0].price || item.offers[0].extracted_price)) || null;
  const currency = item.currency || (priceRaw && String(priceRaw).replace(/[\d.,\s]/g, '').trim()) || null;
  const price = parsePrice(priceRaw);
  const merchant = item.merchant || item.source || item.store || null;

  return {
    title: title,
    price: price,
    currency: currency,
    image: thumbnail,
    link: link,
    merchant: merchant,
    raw: item
  };
}

async function callSerpApi(query, apiKey) {
  const params = new URLSearchParams({
    q: query,
    engine: 'google_shopping',
    hl: 'en',
    gl: 'IN',
    num: '20',
    api_key: apiKey
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(()=>null);
    throw new Error(`SerpApi HTTP ${res.status} ${text ? ' - ' + text : ''}`);
  }
  return await res.json();
}

async function callFakeStore(query) {
  const resp = await fetch('https://fakestoreapi.com/products');
  const items = await resp.json();
  const filtered = items.filter(p => p.title && p.title.toLowerCase().includes(query.toLowerCase()))
    .map(p => ({
      title: p.title,
      price: p.price,
      currency: 'USD',
      image: p.image,
      link: `https://fakestoreapi.com/products/${p.id}`,
      merchant: 'FakeStore'
    }));
  return filtered;
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Accept GET ?query= or POST { "query": "..." }
    const query = (req.query.query || (req.body && req.body.query) || '').toString().trim();
    if (!query) return res.status(400).json({ error: 'Missing query parameter' });

    // Basic cache
    const cacheKey = `q:${query.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return res.status(200).json({ source: 'cache', results: cached.data });
    }

    // Read API key (support multiple names)
    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY || process.env.SERPAPIKEY || process.env.SERP_KEY || null;
    let normalized = [];

    if (apiKey) {
      try {
        const serp = await callSerpApi(query, apiKey);
        const rawList = serp.shopping_results || serp.inline_shopping_results || serp['shopping_results'] || [];
        if (Array.isArray(rawList) && rawList.length > 0) {
          normalized = rawList
            .map(normalizeSerpItem)
            .filter(it => it.price != null && it.link) // ensure we have price & link
            .sort((a,b) => (a.price || 0) - (b.price || 0));
        }
      } catch (err) {
        console.error('SerpApi error:', err && err.message ? err.message : err);
        // don't throw — fallback to FakeStore below
      }
    }

    // Fallback to FakeStore if no results
    if (!normalized || normalized.length === 0) {
      const fallback = await callFakeStore(query);
      normalized = (fallback || []).sort((a,b) => (a.price || 0) - (b.price || 0));
    }

    // Cache and return
    cache.set(cacheKey, { ts: Date.now(), data: normalized });
    res.status(200).json({ source: apiKey ? 'serpapi-or-fallback' : 'fallback-only', results: normalized });
  } catch (err) {
    console.error('Handler error:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Server error', details: (err && err.message) || err });
  }
}
