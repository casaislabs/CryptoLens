import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner"; // Import toast library

function TokenCard({
  id,
  name,
  symbol,
  current_price,
  image,
  price_change_percentage_24h,
  market_cap,
  total_volume,
  volume_24h,
  updateFavorites,
  favorites = [] // Default value: empty array
}) {
  const [pendingFavorite, setPendingFavorite] = useState(false);

  const isFav = Array.isArray(favorites) && favorites.includes(id);

  const toggleFavorite = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (pendingFavorite) return;
    setPendingFavorite(true);

    const updated = isFav
      ? favorites.filter((fav) => fav !== id)
      : [...new Set([...favorites, id])];

    try {
      const ok = await Promise.resolve(updateFavorites(updated));
      if (ok === false) throw new Error('Update favorites failed');
      toast.success(isFav ? "Removed from favorites" : "Added to favorites", {
        style: { backgroundColor: "#333", color: "#fff" },
      });
    } catch (err) {
      toast.error("Failed to update favorites. Restoring previous state.", {
        style: { backgroundColor: "#333", color: "#fff" },
      });
    } finally {
      setPendingFavorite(false);
    }
  };

  return (
    <Link
      href={`/token/${id}`}
      className={"relative w-full max-w-xs p-5 rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-md transition-all duration-300 cursor-pointer group hover:shadow-xl hover:scale-[1.015]"}
      prefetch={true}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/20">
          <Image
            src={image || "/icons/default.png"}
            alt={`${symbol} icon`}
            width={24}
            height={24}
            className="object-contain"
            style={{ width: 'auto', height: 'auto' }}
            loading="lazy"
            sizes="(max-width: 640px) 40px, 40px"
          />
        </div>
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold text-white">{name}</h2>
          <span className="text-xs text-zinc-400 uppercase">{symbol}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xl font-bold text-white">
              {typeof current_price === "number" ? `$${current_price.toFixed(2)}` : "N/A"}
            </p>
            <p
              className={`text-sm ${
                price_change_percentage_24h > 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {typeof price_change_percentage_24h === "number"
                ? `${price_change_percentage_24h.toFixed(2)}%`
                : "N/A"}
            </p>
          </div>
          <Button
            size="sm"
            variant={isFav ? "destructive" : "secondary"}
            disabled={pendingFavorite}
            onClick={toggleFavorite}
          >
            {pendingFavorite ? "…" : isFav ? "★" : "☆"}
          </Button>
        </div>
        
        {/* Market Cap and Volume */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-zinc-400">Market Cap</p>
            <p className="text-white font-medium">
              {typeof market_cap === "number" 
                ? `$${(market_cap / 1e9).toFixed(2)}B` 
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-zinc-400">Volume 24h</p>
            <p className="text-white font-medium">
              {typeof (total_volume ?? volume_24h) === "number" 
                ? `$${(((total_volume ?? volume_24h) / 1e6)).toFixed(1)}M` 
                : "N/A"}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function areEqual(prev, next) {
  // If favorites length changes, force re-render to avoid using a stale list
  const prevLen = Array.isArray(prev.favorites) ? prev.favorites.length : 0;
  const nextLen = Array.isArray(next.favorites) ? next.favorites.length : 0;
  if (prevLen !== nextLen) return false;

  // Re-render only if relevant fields or favorite status change
  const prevFav = Array.isArray(prev.favorites) && prev.favorites.includes(prev.id);
  const nextFav = Array.isArray(next.favorites) && next.favorites.includes(next.id);
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.symbol === next.symbol &&
    prev.current_price === next.current_price &&
    prev.price_change_percentage_24h === next.price_change_percentage_24h &&
    prev.market_cap === next.market_cap &&
    prev.total_volume === next.total_volume &&
    prev.image === next.image &&
    prevFav === nextFav
  );
}

export default React.memo(TokenCard, areEqual);