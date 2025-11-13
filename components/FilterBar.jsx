import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Search, Filter, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function FilterBar({ 
  onFiltersChange, 
  totalTokens = 0,
  filteredCount = 0 
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [filters, setFilters] = useState({
    priceRange: "all",
    volumeRange: "all",
    sortBy: "market_cap",
    sortOrder: "desc"
  });



  // Price ranges
  const priceRanges = [
    { value: "all", label: "All prices" },
    { value: "under-1", label: "Under $1" },
    { value: "1-10", label: "$1 - $10" },
    { value: "10-100", label: "$10 - $100" },
    { value: "100-1000", label: "$100 - $1,000" },
    { value: "over-1000", label: "Over $1,000" }
  ];

  // Volume ranges (24h)
  const volumeRanges = [
    { value: "all", label: "All volume" },
    { value: "under-1m", label: "Under $1M" },
    { value: "1m-10m", label: "$1M - $10M" },
    { value: "10m-100m", label: "$10M - $100M" },
    { value: "100m-1b", label: "$100M - $1B" },
    { value: "over-1b", label: "Over $1B" }
  ];

  // Sorting options
  const sortOptions = [
    { value: "market_cap", label: "Market Cap" },
    { value: "current_price", label: "Price" },
    { value: "total_volume", label: "24h Volume" },
    { value: "price_change_percentage_24h", label: "24h Change" },
    { value: "name", label: "Name" }
  ];

  // Effect to notify filter changes (do not depend on handler to avoid loops)
  useEffect(() => {
    const allFilters = {
      searchTerm: searchTerm.trim(),
      ...filters
    };
    onFiltersChange(allFilters);
  }, [searchTerm, filters, onFiltersChange]);

  // Handle filter changes
  const handleFilterChange = (filterType, value) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: value
    }));

    toast.success(`Filter updated`, {
      style: {
        backgroundColor: "#333",
        color: "#fff",
      },
    });
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSearchTerm("");
    setFilters({
      priceRange: "all",
      volumeRange: "all",
      sortBy: "market_cap",
      sortOrder: "desc"
    });

    toast.success("Filters cleared", {
      style: {
        backgroundColor: "#333",
        color: "#fff",
      },
    });
  };

  // Check if filters are active
  const hasActiveFilters = () => {
    return searchTerm.trim() !== "" || 
           filters.category !== "all" || 
           filters.priceRange !== "all" || 
           filters.volumeRange !== "all" ||
           filters.sortBy !== "market_cap" ||
           filters.sortOrder !== "desc";
  };

  return (
    <Card className="mb-6 bg-neutral-800 shadow-lg rounded-lg border border-neutral-700">
      <CardContent className="p-6">
        {/* Main search bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search tokens by name or symbol..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          
          <Button
            onClick={() => setIsExpanded(!isExpanded)}
            variant="outline"
            className="flex items-center gap-2 bg-neutral-700 border-neutral-600 text-white hover:bg-neutral-600"
          >
            <Filter className="w-4 h-4" />
            Advanced Filters
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>

        {/* Results counter */}
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-gray-400">
            Showing {filteredCount} of {totalTokens} tokens
            {hasActiveFilters() && " (filtered)"}
          </p>
          {hasActiveFilters() && (
            <Button
              onClick={clearAllFilters}
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
            >
              <X className="w-4 h-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>

        {/* Expanded filters */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}>
          {isExpanded && (
            <>
              <Separator className="mb-6 bg-neutral-700" />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-300">
              {/* Price range filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Price Range
                </label>
                <select
                  value={filters.priceRange}
                  onChange={(e) => handleFilterChange('priceRange', e.target.value)}
                  className="w-full p-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-neutral-600 transition-all duration-200 cursor-pointer"
                >
                  {priceRanges.map(range => (
                    <option key={range.value} value={range.value}>{range.label}</option>
                  ))}
                </select>
              </div>

              {/* Volume filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  24h Volume
                </label>
                <select
                  value={filters.volumeRange}
                  onChange={(e) => handleFilterChange('volumeRange', e.target.value)}
                  className="w-full p-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-neutral-600 transition-all duration-200 cursor-pointer"
                >
                  {volumeRanges.map(range => (
                    <option key={range.value} value={range.value}>{range.label}</option>
                  ))}
                </select>
              </div>

              {/* Sort by */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Sort by
                </label>
                <select
                  value={filters.sortBy}
                  onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                  className="w-full p-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-neutral-600 transition-all duration-200 cursor-pointer"
                >
                  {sortOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {/* Order */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Order
                </label>
                <select
                  value={filters.sortOrder}
                  onChange={(e) => handleFilterChange('sortOrder', e.target.value)}
                  className="w-full p-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-neutral-600 transition-all duration-200 cursor-pointer"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}