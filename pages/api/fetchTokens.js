import { createSupabaseClientWithJwt } from '@/lib/supabase';
import { makeSupabaseJwsFromToken } from '@/lib/jwt';
import { getToken } from 'next-auth/jwt';
import { setNoStore, sendError, ensureMethod } from '@/lib/http';
import { FetchTokensQuery, TokenId, parseOrThrow } from '@/lib/validation';
import { getAllPrices, fetchDataWithRetries } from '@/lib/priceCache';
import { createLogger } from '@/lib/logger';
let log = createLogger('api:fetchTokens');

// Function to get a user's favorites from Supabase
async function getUserFavorites(supabaseClient, userId) {
  const { data, error } = await supabaseClient
    .from('favorites')
    .select('token_id')
    .eq('user_id', userId);
  
  if (error) {
    throw error;
  }
  
  return data.map(fav => fav.token_id);
}

// Function to update prices in Redis
// Centralized cache in lib/priceCache handles cron and prewarming
function parseIdsParam(idsRaw) {
  // Validate presence
  const { ids } = parseOrThrow(FetchTokensQuery, { ids: idsRaw });
  if (ids === 'all' || ids === 'favorites') return { mode: ids, list: null };

  const list = Array.from(new Set(ids.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)));
  if (list.length === 0) {
    const err = new Error('Validation error');
    err.name = 'ValidationError';
    err.details = [{ path: ['ids'], message: 'No valid IDs provided' }];
    throw err;
  }

  // validate each id
  for (const id of list) {
    const v = TokenId.safeParse(id);
    if (!v.success) {
      const err = new Error('Validation error');
      err.name = 'ValidationError';
      err.details = [{ path: ['ids'], message: `Invalid token id: ${id}` }];
      throw err;
    }
  }
  if (list.length > 100) {
    const err = new Error('Validation error');
    err.name = 'ValidationError';
    err.details = [{ path: ['ids'], message: 'Too many IDs (max 100)' }];
    throw err;
  }
  return { mode: 'list', list };
}

export default async function handler(req, res) {
  const ensure = ensureMethod(req, res, ['GET']);
  if (ensure) return;
  setNoStore(res);

  const requestId = req.headers['x-request-id'] || null;
  log = log.child('request', { requestId });

  const now = Date.now();
  let parsed;

  try {
    parsed = parseIdsParam(req.query?.ids);
    let data;

    if (parsed.mode === 'all') {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', '</api/tokens/all>; rel="successor-version"');
      return sendError(res, 410, 'DEPRECATED_ENDPOINT', 'Use /api/tokens/all instead of /api/fetchTokens?ids=all');
    } else if (parsed.mode === 'favorites') {
      // Handle user favorites from Supabase
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      if (!token?.id) {
        return sendError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
      }
      const userId = token.id;
      log = log.child('request', { requestId, userId });

      // Create JWS (3 parts) and Supabase client for RLS
      const jws = makeSupabaseJwsFromToken(token);
      const supabaseClient = createSupabaseClientWithJwt(jws);
      const favoriteIds = await getUserFavorites(supabaseClient, userId);

      if (favoriteIds.length === 0) {
        return res.status(200).json([]); // If there are no favorites, return an empty array
      }

      // Try to get prices from centralized cache
      try {
        const allPrices = await getAllPrices();
        data = allPrices.filter((token) => favoriteIds.includes(token.id));
      } catch (e) {
        // If cache fails, call the external API
        const coinGeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${favoriteIds.join(",")}`;
        data = await fetchDataWithRetries(coinGeckoUrl);
      }
    } else {
      // Handle specific tokens
      const validIds = parsed.list;

      // Try to get from centralized cache and filter
      try {
        const allPrices = await getAllPrices();
        const filteredPrices = allPrices.filter((token) => validIds.includes(token.id));
        if (filteredPrices.length === validIds.length) {
          return res.status(200).json(filteredPrices);
        }
      } catch (e) {
        // continue to direct fetch
      }

      // If data is missing in cache, call the external API
      const coinGeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${validIds.join(",")}`;
      data = await fetchDataWithRetries(coinGeckoUrl);
    }

    const formattedData = data.map((coin) => ({
      id: coin.id?.toLowerCase(),
      name: coin.name,
      symbol: coin.symbol?.toUpperCase(),
      current_price: coin.current_price ?? null,
      price_change_percentage_24h: coin.price_change_percentage_24h ?? null,
      market_cap: coin.market_cap ?? null,
      volume_24h: (coin.total_volume ?? coin.volume_24h) ?? null,
      image: coin.image,
    }));

    return res.status(200).json(formattedData);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request', error.details);
    }
    // Try fallback to CoinMarketCap for 'all' or a specific list
    try {
      const isAll = parsed?.mode === 'all';
      const cmcUrl = isAll
        ? `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=100`
        : `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=${(parsed?.list || []).join(',')}`;
      const headers = { "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY };
      const cmcData = await fetchDataWithRetries(cmcUrl, { headers });

      const formattedData = isAll
        ? cmcData.data.map((coin) => ({
            id: coin.slug.toLowerCase(),
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            current_price: coin.quote?.USD?.price || null,
            price_change_percentage_24h: coin.quote?.USD?.percent_change_24h || null,
            market_cap: coin.quote?.USD?.market_cap || null,
            volume_24h: coin.quote?.USD?.volume_24h || null,
            image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
          }))
        : Object.values(cmcData.data).map((coin) => ({
            id: coin.slug.toLowerCase(),
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            current_price: coin.quote?.USD?.price || null,
            price_change_percentage_24h: coin.quote?.USD?.percent_change_24h || null,
            market_cap: coin.quote?.USD?.market_cap || null,
            volume_24h: coin.quote?.USD?.volume_24h || null,
            image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
          }));

      const validatedData = formattedData.filter((coin) => coin.current_price !== null);
      if (validatedData.length === 0) {
        throw new Error('No valid data fetched.');
      }
      return res.status(200).json(validatedData);
    } catch (fallbackErr) {
      log.error('Fallback to CMC failed', { error: fallbackErr.message || fallbackErr });
      return sendError(res, 500, 'INTERNAL_ERROR', 'All APIs failed to fetch data.', { reason: fallbackErr.message });
    }
  }
}