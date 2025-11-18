import { useRouter } from "next/router";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tooltip as ShadTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner"; // Import toast library
import { useEffect, useState, useRef } from "react";
import { debounce } from "lodash";
import { createLogger } from '@/lib/logger';
const log = createLogger('client:tokenPage');

const TokenChart = dynamic(() => import("@/components/TokenChart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[300px] text-gray-400">
      <p>Loading chart...</p>
    </div>
  ),
});

export default function TokenDetails({ token: initialToken, chartData: initialChartData }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [chartData, setChartData] = useState(initialChartData);
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState(false);
  const abortControllerRef = useRef(null);

  // Debounced function to load token data
  const debouncedFetchToken = useRef(
    debounce(async (tokenId) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      // Create new AbortController
      abortControllerRef.current = new AbortController();
      
      try {
        setLoading(true);
        setChartError(false);
        log.info('Fetching data for token', { tokenId });
        
        const response = await fetch(`/api/token/${tokenId}`, {
          signal: abortControllerRef.current.signal
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            toast.error('Too many requests. Please wait a moment before switching tokens.');
            return;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        log.debug('API Response data', { data });
        log.debug('Chart data received', { chartData: data.chartData });
        
        setToken(data.token);
        
        // Validar chartData antes de establecerlo
        if (data.chartData && Array.isArray(data.chartData) && data.chartData.length > 0) {
          setChartData(data.chartData);
          setChartError(false);
        } else {
          log.warn('Invalid or empty chart data received', { chartData: data.chartData });
          setChartData([]);
          setChartError(true);
        }
        
        log.info('Successfully loaded token data', { tokenId });
        log.debug('Chart data state after setting', { chartData: data.chartData });
      } catch (error) {
        if (error.name === 'AbortError') {
          log.debug('Request was cancelled');
          return;
        }
        log.error('Error fetching token data', { error });
        toast.error('Error loading token data. Please try again.');
      } finally {
        setLoading(false);
      }
    }, 500) // 500ms debounce
  ).current;

  // Effect to reload data when the ID changes
  useEffect(() => {
    if (router.query.id && router.query.id !== token?.id) {
      // Clear previous data immediately
      setToken(null);
      setChartData([]);
      setChartError(false);
      log.debug('Token changed, clearing data', { from: token?.id, to: router.query.id });
      
      debouncedFetchToken(router.query.id);
    }
    
    // Cleanup function to cancel pending requests
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [router.query.id, token?.id, debouncedFetchToken]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      debouncedFetchToken.cancel();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [debouncedFetchToken]);

  if (router.isFallback || !token || loading) {
    return <div className="text-center p-10 text-white">Loading...</div>;
  }

  const handleBack = () => {
    // Show a toast while returning to dashboard
    toast("Loading dashboard...", {
      style: { backgroundColor: "#333", color: "#fff" },
    });

    // Go back using history if available; otherwise go to dashboard
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-900 to-black text-gray-100 p-8">
      <div className="max-w-screen-lg mx-auto">
        {/* Back Button */}
        <Button
          variant="outline"
          onClick={handleBack}
          className="mb-6 hover:shadow-lg transition-shadow duration-200"
        >
          ← Back
        </Button>

        {/* Token Details */}
        <Card className="bg-neutral-800 shadow-lg rounded-lg">
          <CardHeader className="p-6">
            <div className="flex items-center gap-4">
              <Image 
                src={token.image.large} 
                alt={token.name} 
                width={50} 
                height={50} 
                style={{ width: 'auto', height: 'auto' }}
              />
              <div>
                <h1 className="text-4xl font-bold text-white">{token.name}</h1>
                <p className="text-xl text-zinc-400 uppercase">{token.symbol}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="mb-8">
              <p className="text-3xl font-semibold text-white">
                ${token.market_data.current_price.usd.toLocaleString()}
              </p>
              <p
                className={`text-lg ${
                  token.market_data.price_change_percentage_24h > 0
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              >
                {token.market_data.price_change_percentage_24h.toFixed(2)}%
              </p>
              
              {/* Market Cap and Volume */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 p-4 bg-neutral-900 rounded-lg">
                <div>
                  <h3 className="text-sm text-zinc-400 mb-1">Market Cap</h3>
                  <p className="text-xl font-semibold text-white">
                    ${token.market_data.market_cap?.usd ? 
                      (token.market_data.market_cap.usd / 1e9).toFixed(2) + 'B' : 
                      'N/A'
                    }
                  </p>
                  <p className="text-sm text-zinc-400">
                    Rank #{token.market_data.market_cap_rank || 'N/A'}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm text-zinc-400 mb-1">Volume 24h</h3>
                  <p className="text-xl font-semibold text-white">
                    ${token.market_data.total_volume?.usd ? 
                      (token.market_data.total_volume.usd / 1e6).toFixed(1) + 'M' : 
                      'N/A'
                    }
                  </p>
                  <p className="text-sm text-zinc-400">
                    {token.market_data.total_volume?.usd && token.market_data.market_cap?.usd ?
                      `${((token.market_data.total_volume.usd / token.market_data.market_cap.usd) * 100).toFixed(2)}% of market cap` :
                      'Volume/Market Cap ratio N/A'
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Chart Section */}
            <h2 className="text-xl font-bold mb-4 text-white">7-Day Price Chart (USD)</h2>
            <TokenChart chartData={chartData} token={token} loading={loading} chartError={chartError} />
           </CardContent>
        </Card>
      </div>
    </main>
  );
}

export async function getServerSideProps({ params, req }) {
  const { id } = params;

  if (!id || typeof id !== "string" || id.trim() === "") {
    return { notFound: true };
  }

  try {
    const proto = req?.headers['x-forwarded-proto'] || 'http';
    const host = req?.headers['host'];
    const inferred = host ? `${proto}://${host}` : null;
    const baseUrl = process.env.NEXTAUTH_URL || inferred || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/token/${id}`);
    if (!res.ok) {
      return { notFound: true };
    }
    const { token, chartData } = await res.json();
    return { props: { token, chartData } };
  } catch (error) {
    log.error('Error fetching token data (SSR)', { error });
    return { props: { token: null, chartData: [] } };
  }
}