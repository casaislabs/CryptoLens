import React, { useEffect, useState, useMemo, Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import TokenCard from "@/components/TokenCard";
import FilterBar from "@/components/FilterBar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner"; // Import Sonner toast
import { createLogger } from '@/lib/logger';
const log = createLogger('client:dashboard');

// Load VirtualizedTokenGrid only on client
const VirtualizedTokenGrid = dynamic(() => import("@/components/VirtualizedTokenGrid"), {
  ssr: false,
  suspense: true,
});

class GridErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    log.error('Virtualized grid error', { error, info });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default function DashboardContentComponent({
  mode,
  topTokens = [],
  favoriteTokens = [],
  loadingFavs = false,
  updateFavorites = () => {},
  favorites = [],
}) {
  // State for filters
  const [filters, setFilters] = useState({
    searchTerm: "",
    category: "all",
    priceRange: "all",
    volumeRange: "all",
    sortBy: "market_cap",
    sortOrder: "desc"
  });
  const [isClient, setIsClient] = useState(false);
  useEffect(() => { setIsClient(true); }, []);
  // Show a toast when favorites load successfully
  useEffect(() => {
    if (!loadingFavs && favoriteTokens.length > 0) {
      toast.success("Favorites loaded successfully!", {
        description: `You have ${favoriteTokens.length} favorite tokens.`,
        style: {
          backgroundColor: "#333", // Dark background
          color: "#fff", // White text
        },
      });
    } else if (!loadingFavs && favoriteTokens.length === 0) {
      toast.error("No favorites found.", {
        description: "You don't have any favorite tokens yet.",
        style: {
          backgroundColor: "#333",
          color: "#fff",
        },
      });
    }
  }, [loadingFavs, favoriteTokens]);

  // Show a toast when top tokens load successfully
  useEffect(() => {
    if (topTokens.length > 0) {
      toast.success("Top tokens loaded successfully!", {
        description: `Displaying ${topTokens.length} top tokens.`,
        style: {
          backgroundColor: "#333",
          color: "#fff",
        },
      });
    } else {
      toast.error("Failed to load top tokens.", {
        description: "Please try again later.",
        style: {
          backgroundColor: "#333",
          color: "#fff",
        },
      });
    }
  }, [topTokens]);

  // Function to filter tokens
  const filterTokens = (tokens, filters) => {
    let filtered = [...tokens];

    // Search filter (name or symbol)
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(token => 
        token.name?.toLowerCase().includes(searchLower) ||
        token.symbol?.toLowerCase().includes(searchLower)
      );
    }

    // Filter by price range
    if (filters.priceRange !== "all") {
      filtered = filtered.filter(token => {
        const price = token.current_price || 0;
        switch (filters.priceRange) {
          case "under-1": return price < 1;
          case "1-10": return price >= 1 && price <= 10;
          case "10-100": return price >= 10 && price <= 100;
          case "100-1000": return price >= 100 && price <= 1000;
          case "over-1000": return price > 1000;
          default: return true;
        }
      });
    }

    // Filter by volume
    if (filters.volumeRange !== "all") {
      filtered = filtered.filter(token => {
        const volume = token.total_volume || 0;
        switch (filters.volumeRange) {
          case "under-1m": return volume < 1000000;
          case "1m-10m": return volume >= 1000000 && volume <= 10000000;
          case "10m-100m": return volume >= 10000000 && volume <= 100000000;
          case "100m-1b": return volume >= 100000000 && volume <= 1000000000;
          case "over-1b": return volume > 1000000000;
          default: return true;
        }
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (filters.sortBy) {
        case "current_price":
          aValue = a.current_price || 0;
          bValue = b.current_price || 0;
          break;
        case "total_volume":
          aValue = a.total_volume || 0;
          bValue = b.total_volume || 0;
          break;
        case "price_change_percentage_24h":
          aValue = a.price_change_percentage_24h || 0;
          bValue = b.price_change_percentage_24h || 0;
          break;
        case "name":
          aValue = a.name || "";
          bValue = b.name || "";
          return filters.sortOrder === "asc" ? 
            aValue.localeCompare(bValue) : 
            bValue.localeCompare(aValue);
        case "market_cap":
        default:
          aValue = a.market_cap || 0;
          bValue = b.market_cap || 0;
          break;
      }
      
      return filters.sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });

    return filtered;
  };

  // Filtered tokens memoized for optimization
  const filteredTopTokens = useMemo(() => {
    return filterTokens(topTokens, filters);
  }, [topTokens, filters]);

  const filteredFavoriteTokens = useMemo(() => {
    return filterTokens(favoriteTokens, filters);
  }, [favoriteTokens, filters]);

  // Handle changes in filters (stable reference)
  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  if (mode === "simple") {
    // Simple mode: show only "Hello" and the first top token
    const firstToken = topTokens[0];
    return (
      <div className="flex flex-col items-center">
        <h1 className="text-4xl font-bold text-white mb-8">Hello</h1>
        {firstToken ? (
          <div className="max-w-sm w-full">
            <TokenCard
              {...firstToken}
              updateFavorites={updateFavorites}
              favorites={favorites}
            />
          </div>
        ) : (
          <p className="text-gray-400">No token data available.</p>
        )}
      </div>
    );
  }

  // Full mode: show the entire dashboard
  return (
    <div className="max-w-screen-xl mx-auto">
      {/* Header removed as requested */}

      {/** Filters bar */}
      <FilterBar 
        onFiltersChange={handleFiltersChange}
        totalTokens={topTokens.length}
        filteredCount={filteredTopTokens.length}
      />

      {/* Statistics Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <Card className="bg-neutral-800 p-4 shadow-md rounded-lg">
          <h2 className="text-lg font-semibold text-gray-300">Total Favorites</h2>
          <p className="text-3xl font-bold text-blue-400">{filteredFavoriteTokens.length}</p>
        </Card>
        <Card className="bg-neutral-800 p-4 shadow-md rounded-lg">
          <h2 className="text-lg font-semibold text-gray-300">Tokens Displayed</h2>
          <p className="text-3xl font-bold text-green-400">{filteredTopTokens.length}</p>
        </Card>
        <Card className="bg-neutral-800 p-4 shadow-md rounded-lg">
          <h2 className="text-lg font-semibold text-gray-300">Total Available</h2>
          <p className="text-3xl font-bold text-purple-400">{topTokens.length}</p>
        </Card>
        <Card className="bg-neutral-800 p-4 shadow-md rounded-lg">
          <h2 className="text-lg font-semibold text-gray-300">Active Filters</h2>
          <p className="text-3xl font-bold text-orange-400">
            {Object.values(filters).filter(v => v !== "all" && v !== "market_cap" && v !== "desc" && v !== "").length}
          </p>
        </Card>
      </div>

      <hr className="border-neutral-700 my-8" />

      {/* Favorites Section */}
      <Card className="mb-10 bg-neutral-800 shadow-lg rounded-lg hover:shadow-xl transition-shadow duration-200">
        <CardHeader className="p-4">
          <CardTitle className="text-xl font-semibold text-blue-400">⭐ Favorites</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {loadingFavs ? (
            <Skeleton className="h-6 w-full bg-neutral-700 rounded-md" />
          ) : filteredFavoriteTokens.length > 0 ? (
            isClient && filteredFavoriteTokens.length > 40 ? (
              <GridErrorBoundary
                fallback={
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredFavoriteTokens
                      .filter((token) => token && token.id)
                      .map((token) => (
                        <TokenCard
                          key={token.id}
                          {...token}
                          updateFavorites={updateFavorites}
                          favorites={favorites}
                        />
                      ))}
                  </div>
                }
              >
                <Suspense
                  fallback={
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                      {filteredFavoriteTokens
                        .filter((token) => token && token.id)
                        .map((token) => (
                          <TokenCard
                            key={token.id}
                            {...token}
                            updateFavorites={updateFavorites}
                            favorites={favorites}
                          />
                        ))}
                    </div>
                  }
                >
                  <VirtualizedTokenGrid
                    items={filteredFavoriteTokens.filter((t) => t && t.id)}
                    height={480}
                    rowHeight={240}
                    renderItem={(token) => (
                      <TokenCard
                        key={token.id}
                        {...token}
                        updateFavorites={updateFavorites}
                        favorites={favorites}
                      />
                    )}
                  />
                </Suspense>
              </GridErrorBoundary>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredFavoriteTokens
                  .filter((token) => token && token.id)
                  .map((token) => (
                    <TokenCard
                      key={token.id}
                      {...token}
                      updateFavorites={updateFavorites}
                      favorites={favorites}
                    />
                  ))}
              </div>
            )
          ) : favoriteTokens.length > 0 ? (
            <p className="text-gray-400 text-center">No favorites found with the current filters.</p>
          ) : (
            <p className="text-gray-400 text-center">No favorites selected.</p>
          )}
        </CardContent>
      </Card>

      <hr className="border-neutral-700 my-8" />

      {/* Top Tokens Section */}
      <Card className="bg-neutral-800 shadow-lg rounded-lg hover:shadow-xl transition-shadow duration-200">
        <CardHeader className="p-4">
          <CardTitle className="text-xl font-semibold text-green-400">🔥 Top Tokens</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
  {filteredTopTokens.length > 0 ? (
    isClient && filteredTopTokens.length > 40 ? (
      <GridErrorBoundary
         fallback={
           <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
             {filteredTopTokens
               .filter((token) => token && token.id)
               .map((token) => (
                 <TokenCard
                   key={token.id}
                   {...token}
                   updateFavorites={updateFavorites}
                   favorites={favorites}
                 />
               ))}
           </div>
         }
       >
         <Suspense
           fallback={
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
               {filteredTopTokens
                 .filter((token) => token && token.id)
                 .map((token) => (
                   <TokenCard
                     key={token.id}
                     {...token}
                     updateFavorites={updateFavorites}
                     favorites={favorites}
                   />
                 ))}
             </div>
           }
         >
           <VirtualizedTokenGrid
             items={filteredTopTokens.filter((t) => t && t.id)}
             height={720}
             rowHeight={240}
             renderItem={(token) => (
               <TokenCard
                 key={token.id}
                 {...token}
                 updateFavorites={updateFavorites}
                 favorites={favorites}
               />
             )}
           />
         </Suspense>
       </GridErrorBoundary>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredTopTokens
          .filter((token) => token && token.id)
          .map((token) => (
            <TokenCard
              key={token.id}
              {...token}
              updateFavorites={updateFavorites}
              favorites={favorites}
            />
          ))}
      </div>
    )
  ) : topTokens.length > 0 ? (
    <p className="text-gray-400 text-center">No tokens found with the current filters.</p>
  ) : (
    <p className="text-gray-400 text-center">No top tokens available.</p>
  )}
</CardContent>
      </Card>
    </div>
  );
}