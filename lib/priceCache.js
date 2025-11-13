import Redis from 'ioredis';
import cron from 'node-cron';

if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/priceCache.js` in the browser. Server/API only.');
}

const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
};

const redis = new Redis(redisConfig);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDataWithRetries(url, options = {}, retries = 3, backoff = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return await res.json();
      } else {
        const errorText = await res.text();
        if (res.status === 429) {
          await delay(backoff);
          backoff *= 2;
        } else {
          throw new Error(`Fetch failed: ${res.status} ${res.statusText} - ${errorText}`);
        }
      }
    } catch (err) {
      if (attempt === retries) throw err;
      await delay(backoff);
      backoff *= 2;
    }
  }
  throw new Error('All retries failed.');
}

async function fetchAllFromCoinGecko() {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1`;
  const data = await fetchDataWithRetries(url);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data.map((coin) => ({
    id: coin.id?.toLowerCase(),
    name: coin.name,
    symbol: coin.symbol?.toUpperCase(),
    current_price: coin.current_price ?? null,
    price_change_percentage_24h: coin.price_change_percentage_24h ?? null,
    market_cap: coin.market_cap ?? null,
    volume_24h: coin.total_volume ?? null,
    image: coin.image,
  }));
}

async function fetchAllFromCMC() {
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100`;
  const headers = { 'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY };
  const cmc = await fetchDataWithRetries(url, { headers });
  if (!cmc || !Array.isArray(cmc.data) || cmc.data.length === 0) return null;
  return cmc.data.map((coin) => ({
    id: coin.slug?.toLowerCase(),
    name: coin.name,
    symbol: coin.symbol?.toUpperCase(),
    current_price: coin.quote?.USD?.price ?? null,
    price_change_percentage_24h: coin.quote?.USD?.percent_change_24h ?? null,
    market_cap: coin.quote?.USD?.market_cap ?? null,
    volume_24h: coin.quote?.USD?.volume_24h ?? null,
    image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
  }));
}

async function refreshAllPrices() {
  let data = await fetchAllFromCoinGecko();
  if (!data) {
    data = await fetchAllFromCMC();
  }
  if (data && data.length) {
    await redis.set('prices:all', JSON.stringify(data), 'EX', 300);
  }
  return data;
}

export async function getAllPrices() {
  const cached = await redis.get('prices:all');
  if (cached) return JSON.parse(cached);
  const data = await refreshAllPrices();
  if (!data) throw new Error('UPSTREAM_UNAVAILABLE');
  return data;
}

export async function getTokensByIds(ids) {
  const all = await getAllPrices();
  const set = new Set(ids.map((s) => s.toLowerCase()));
  const filtered = all.filter((c) => set.has(c.id));
  // If missing any, fetch specifically from CoinGecko and fallback CMC
  if (filtered.length === ids.length) return filtered;
  const cgUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}`;
  try {
    const cg = await fetchDataWithRetries(cgUrl);
    return cg.map((coin) => ({
      id: coin.id?.toLowerCase(),
      name: coin.name,
      symbol: coin.symbol?.toUpperCase(),
      current_price: coin.current_price ?? null,
      price_change_percentage_24h: coin.price_change_percentage_24h ?? null,
      market_cap: coin.market_cap ?? null,
      volume_24h: coin.total_volume ?? null,
      image: coin.image,
    }));
  } catch (e) {
    const cmcUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=${ids.join(',')}`;
    const headers = { 'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY };
    const cmc = await fetchDataWithRetries(cmcUrl, { headers });
    return Object.values(cmc.data).map((coin) => ({
      id: coin.slug?.toLowerCase(),
      name: coin.name,
      symbol: coin.symbol?.toUpperCase(),
      current_price: coin.quote?.USD?.price ?? null,
      price_change_percentage_24h: coin.quote?.USD?.percent_change_24h ?? null,
      market_cap: coin.quote?.USD?.market_cap ?? null,
      volume_24h: coin.quote?.USD?.volume_24h ?? null,
      image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
    }));
  }
}

function ensureCron() {
  if (globalThis.__price_cache_cron_started) return;
  cron.schedule('*/5 * * * *', async () => {
    try { await refreshAllPrices(); } catch (e) { /* noop */ }
  });
  // Preload once at server start
  refreshAllPrices().catch(() => {});
  globalThis.__price_cache_cron_started = true;
}

ensureCron();

export { redis };