import React from "react";
import DashboardContentComponent from "@/components/dashboardContentComponent";

export default function DashboardContent({
  topTokens = [],
  favoriteTokens = [],
  loadingFavs = false,
  updateFavorites = () => {},
  favorites = [],
  variant = "simple", // Default value for variant
}) {
  return (
    <div>
      {/* Main dashboard component */}
      <DashboardContentComponent
        mode={variant} // "simple" or "full"
        topTokens={topTokens}
        favoriteTokens={favoriteTokens}
        loadingFavs={loadingFavs}
        updateFavorites={updateFavorites}
        favorites={favorites}
      />

      {/* Additional content for the "full" mode */}
      {variant === "full" && (
        <div>
          <h2>Exclusive content for authenticated users</h2>
          {/** Add more logic or components here if needed */}
        </div>
      )}
    </div>
  );
}