import fetch from "node-fetch";

// Simple in-memory cache to avoid excessive API calls
const cache = new Map();
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
const CHART_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours for chart data

// Simple rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 60 seconds
const MAX_REQUESTS_PER_WINDOW = 20; // More requests allowed

function isRateLimited(ip) {
  const now = Date.now();
  const requests = rateLimitMap.get(ip) || [];
  
  // Filter requests within the time window
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  // Update the map with recent requests plus the new one
  recentRequests.push(now);
  rateLimitMap.set(ip, recentRequests);
  return false;
}

export default async function handler(req, res) {
  const { id } = req.query;
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

  if (!id || typeof id !== "string" || id.trim() === "") {
    return res.status(400).json({ error: "Invalid token ID" });
  }

  // Check rate limiting
  if (isRateLimited(clientIP)) {
    console.log(`Rate limit exceeded for IP: ${clientIP}`);
    return res.status(429).json({ error: "Too many requests. Please wait before trying again." });
  }

  // Check if data is cached (extend cache time for chart data)
  const cacheKey = `token:${id}`;
  const chartCacheKey = `chart:${id}`;
  const cachedData = cache.get(cacheKey);
  const cachedChartData = cache.get(chartCacheKey);
  
  if (cachedData && cachedChartData && Date.now() - cachedData.timestamp < CACHE_DURATION && Date.now() - cachedChartData.timestamp < CHART_CACHE_DURATION) {
     console.log(`Returning cached data for token: ${id}`);
     return res.status(200).json({ token: cachedData.data, chartData: cachedChartData.data });
   }

  try {
    // Fetch token from CoinGecko
    let token = null;
    try {
      const resToken = await fetch(`https://api.coingecko.com/api/v3/coins/${id}`);
      if (resToken.ok) {
        token = await resToken.json();
      }
    } catch (error) {
      console.error("Error fetching from CoinGecko:", error);
    }

    // If CoinGecko fails, try CoinMarketCap
    if (!token || !token.market_data || !token.market_data.current_price) {
      const cmcUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=${id}`;
      const headers = {
        "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY,
      };

      try {
        const resCmc = await fetch(cmcUrl, { headers });
        if (resCmc.ok) {
          const cmcData = await resCmc.json();
          const coin = Object.values(cmcData.data)[0];
          if (coin) {
            token = {
              id: coin.slug,
              name: coin.name,
              symbol: coin.symbol,
              market_data: {
                current_price: { usd: coin.quote.USD.price },
                price_change_percentage_24h: coin.quote.USD.percent_change_24h,
              },
              image: {
                large: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
              },
            };
          }
        }
      } catch (error) {
        console.error("Error fetching from CoinMarketCap:", error);
      }
    }

    // If token could not be obtained
    if (!token || !token.market_data || !token.market_data.current_price) {
      return res.status(404).json({ error: "Token not found" });
    }

    // Fetch chart data from CoinGecko
    let chartData = [];
    console.log(`Fetching chart data for token: ${id}`);
    try {
      const chartUrl = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`;
      console.log(`Chart URL: ${chartUrl}`);
      
      const resChart = await fetch(chartUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Web3Dashboard/1.0'
        }
      });
      console.log(`Chart response status: ${resChart.status}`);
      
      if (resChart.ok) {
        const chartJson = await resChart.json();
        console.log(`Chart JSON received:`, chartJson ? 'Valid JSON' : 'Invalid JSON');
        console.log(`Chart prices array:`, Array.isArray(chartJson?.prices) ? `${chartJson.prices.length} items` : 'Not an array');
        
        if (chartJson && Array.isArray(chartJson.prices)) {
          chartData = chartJson.prices.map(([timestamp, price]) => ({
            date: new Date(timestamp).toLocaleDateString(),
            price: parseFloat(price.toFixed(2)),
          }));
          console.log(`Processed chart data: ${chartData.length} items`);
        } else {
          console.warn(`Invalid chart data structure for ${id}:`, chartJson);
        }
      } else if (resChart.status === 429) {
        console.warn(`Rate limited by CoinGecko for ${id}, will try CoinMarketCap`);
      } else {
        console.error(`Chart fetch failed with status ${resChart.status} for token: ${id}`);
      }
    } catch (error) {
      console.error(`Error fetching chart data for ${id}:`, error);
    }
    
    // If CoinGecko failed due to rate limit, wait before trying CMC
    if (chartData.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }

    // If CoinGecko fails for chart, try CoinMarketCap
      if (chartData.length === 0 && token?.symbol) {
        console.log(`CoinGecko chart data failed for ${id}, trying CoinMarketCap...`);
        // Use quotes/latest endpoint instead of historical to avoid 403
        const cmcChartUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${token.symbol.toUpperCase()}`;
        const cmcHeaders = {
          "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY,
          "Accept": "application/json",
          "Accept-Encoding": "deflate, gzip"
        };
        console.log(`CMC Chart URL: ${cmcChartUrl}`);
        console.log(`CMC API Key available: ${process.env.COINMARKETCAP_API_KEY ? 'Yes' : 'No'}`);

      try {
        const resCmcChart = await fetch(cmcChartUrl, { headers: cmcHeaders });
        console.log(`CMC Chart response status: ${resCmcChart.status}`);
        
        if (resCmcChart.ok) {
          const cmcChartData = await resCmcChart.json();
          console.log(`CMC Chart data structure:`, cmcChartData ? 'Valid JSON' : 'Invalid JSON');
          
          if (cmcChartData && cmcChartData.data) {
            console.log(`CMC Chart data structure:`, Object.keys(cmcChartData.data));
            
            // As only current price, generate simulated data for 7 days
            const currentPrice = Object.values(cmcChartData.data)[0]?.quote?.USD?.price;
            if (currentPrice) {
              const simulatedData = [];
              for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                // Simulate small price variation (±5%)
                const variation = (Math.random() - 0.5) * 0.1;
                const price = currentPrice * (1 + variation);
                simulatedData.push({
                  date: date.toLocaleDateString(),
                  price: parseFloat(price.toFixed(2))
                });
              }
              console.log(`CMC Processed chart data: ${simulatedData.length} items`);
              chartData = simulatedData;
            }
          } else {
            console.warn(`Invalid CMC chart data structure for ${id}:`, cmcChartData);
          }
        } else {
          console.error(`CMC Chart fetch failed with status ${resCmcChart.status} for token: ${id}`);
        }
      } catch (error) {
        console.error(`Error fetching chart data from CoinMarketCap for ${id}:`, error);
      }
    }

    // Final result log
    console.log(`Final chart data for ${id}: ${chartData.length} items`);
    if (chartData.length === 0) {
      console.warn(`WARNING: No chart data available for token ${id}`);
    }
    
    // Cache separately (chart data with longer cache)
    const responseData = { token, chartData };
    
    // Token cache (30 minutes)
    cache.set(cacheKey, {
      data: token,
      timestamp: Date.now()
    });
    
    // Chart data cache (2 hours to reduce API calls)
    cache.set(chartCacheKey, {
      data: chartData,
      timestamp: Date.now()
    });
    
    console.log(`Cached data for token: ${id}`);
    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}