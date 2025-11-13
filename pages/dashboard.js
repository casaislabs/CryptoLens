import { useState, useEffect } from "react";
import { useSession } from "next-auth/react"; // signOut is now handled by AppHeader
import DashboardContentComponent from "@/components/dashboardContentComponent";
import AppHeader from "@/components/AppHeader";
import { toast } from "sonner"; // Import the toast library
import { parseApiError, formatValidationDetails, getFriendlyErrorMessage } from '@/lib/apiErrors';
import Head from "next/head";
import { createLogger } from '@/lib/logger';
const log = createLogger('client:dashboardPage');



export default function Dashboard({ tokens }) {
  const { data: session } = useSession();

  const [favorites, setFavorites] = useState([]);
  const [favoriteTokens, setFavoriteTokens] = useState([]);
  const [loadingFavs, setLoadingFavs] = useState(false);
  const [topTokens, setTopTokens] = useState(tokens);

  useEffect(() => {
    log.debug('Favorites loaded from localStorage', { favorites });
  }, [favorites]);

  useEffect(() => {
    if (tokens && tokens.length > 0) {
      log.debug('Tokens from server', { tokens });
      localStorage.setItem("lastTokens", JSON.stringify(tokens));
      setTopTokens(tokens);
    }
  }, [tokens]);

  useEffect(() => {
    const syncFavorites = async () => {
      const stored = JSON.parse(localStorage.getItem("favorites")) || [];
      const favIds = stored.map((f) => (typeof f === "object" && f?.id ? f.id : f));
  
      try {
        // Validate that session and userId are available
        if (!session?.user?.id) {
          log.error('User ID is missing in session');
          setFavorites(favIds); // Use local favorites if no session
          if (favIds.length > 0) {
            fetchFavorites(favIds);
          } else {
            setFavoriteTokens([]);
          }
          return;
        }
  
        // Get real favorites from the server
        const response = await fetch(`/api/updateFavorites`);
        if (response.ok) {
          const serverFavorites = await response.json();
          log.debug('Favorites from server', { serverFavorites });
  
          // Sync favorites between localStorage and the server
          if (JSON.stringify(favIds) !== JSON.stringify(serverFavorites)) {
            log.info('Syncing localStorage with server favorites');
            localStorage.setItem("favorites", JSON.stringify(serverFavorites));
            setFavorites(serverFavorites);
          } else {
            setFavorites(favIds);
          }
  
          // Fetch favorite tokens
          if (serverFavorites.length > 0) {
            fetchFavorites(serverFavorites);
          } else {
            setFavoriteTokens([]);
          }
        } else {
          log.error('Failed to fetch favorites from server');
          setFavorites(favIds);
          if (favIds.length > 0) {
            fetchFavorites(favIds);
          } else {
            setFavoriteTokens([]);
          }
        }
      } catch (err) {
        log.error('Error syncing favorites', { error: err });
        setFavorites(favIds);
        if (favIds.length > 0) {
          fetchFavorites(favIds);
        } else {
          setFavoriteTokens([]);
        }
      }
    };
  
    if (session?.user?.id) {
      log.info('Session and user ID available. Syncing favorites');
      syncFavorites();
    } else {
      log.warn('Session or user ID is not available. Skipping syncFavorites');
    }
  }, [session]);

  const updateFavorites = async (updated) => {
    if (!session || !session.user || !session.user.id) {
      toast.error("User session is not available. Please log in again.", {
        style: { backgroundColor: "#333", color: "#fff" },
      });
      return false;
    }
  
    const ids = [...new Set(updated.filter((f) => (typeof f === "string" && f) || typeof f === "number"))];
    log.debug('Filtered favorites to update', { ids });

    const prev = favorites;
    setFavorites(ids);
    localStorage.setItem("favorites", JSON.stringify(ids));
  
    try {
      const response = await fetch("/api/updateFavorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites: ids }),
      });
  
      if (!response.ok) {
        const errInfo = await parseApiError(response);
        if (errInfo.status === 401 || errInfo.code === 'NOT_AUTHENTICATED') {
          toast.error('Your session has expired. Please sign in.', { style: { backgroundColor: "#333", color: "#fff" } });
          return false;
        }
        const details = formatValidationDetails(errInfo.details);
        const msg = errInfo.message || getFriendlyErrorMessage(errInfo.code, 'Failed to update favorites');
        throw new Error(details ? `${msg}: ${details}` : msg);
      }
  
      toast.success("Favorites updated successfully!", {
        style: { backgroundColor: "#333", color: "#fff" },
      });
  
      // Refresh favorites after updating
      fetchFavorites(ids);
      return true;
    } catch (err) {
      log.error('Error updating favorites', { error: err });
      // Revert local state and localStorage if server update fails
      setFavorites(prev);
      localStorage.setItem("favorites", JSON.stringify(prev));
      toast.error(err?.message || "Failed to update favorites on the server.", {
        style: { backgroundColor: "#333", color: "#fff" },
      });
      return false;
    }
  };

  async function fetchFavorites(favIds) {
    if (!Array.isArray(favIds) || favIds.length === 0) {
      setFavoriteTokens([]);
      return;
    }
  
    // Filter valid IDs
    const validIds = favIds.filter((id) => typeof id === "string" && id.trim() !== "");
    if (validIds.length === 0) {
      setFavoriteTokens([]);
      return;
    }
  
    setLoadingFavs(true);
  
    try {
      // Build the favorite tokens URL without sending userId
      const apiUrl = `/api/fetchTokens?ids=${validIds.join(",")}`;
      // Call the API to get favorite tokens
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errInfo = await parseApiError(response);
        if (errInfo.status === 401 || errInfo.code === 'NOT_AUTHENTICATED') {
          toast.error('Your session has expired. Please sign in.', { style: { backgroundColor: "#333", color: "#fff" } });
          setFavoriteTokens([]);
          return;
        }
        const msg = errInfo.message || getFriendlyErrorMessage(errInfo.code, 'Error fetching tokens');
        throw new Error(msg);
      }
  
      const data = await response.json();
      log.debug('Fetched favorite tokens', { data });
  
      // Save favorite tokens to localStorage
      localStorage.setItem("lastFavoriteTokens", JSON.stringify(data));
      setFavoriteTokens(data);
    } catch (err) {
      log.error('Error fetching favorites', { error: err });
  
      // Show an error message and use cached data if available
      toast.error("Failed to fetch favorite tokens. Using cached data.", {
        description: err?.message,
        style: { backgroundColor: "#333", color: "#fff" },
      });
  
      const cachedFavs = JSON.parse(localStorage.getItem("lastFavoriteTokens") || "[]");
      if (Array.isArray(cachedFavs) && cachedFavs.length > 0) {
        setFavoriteTokens(cachedFavs);
      } else {
        setFavoriteTokens([]);
      }
    } finally {
      setLoadingFavs(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Head>
        <title>CryptoLens — Dashboard</title>
        <meta name="description" content="Your personalized crypto dashboard to track tokens and manage favorites." />
        <link rel="canonical" href="https://cryptolens.casaislabs.com/dashboard" />
      </Head>
      <AppHeader title="CryptoLens" />
      {/* Dashboard Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <DashboardContentComponent
          topTokens={topTokens}
          favoriteTokens={favoriteTokens}
          loadingFavs={loadingFavs}
          updateFavorites={updateFavorites}
          favorites={favorites}
        />
      </div>
    </div>
  );
}

// Protect the route server-side
export async function getServerSideProps(context) {
  const { getSession } = await import("next-auth/react");
  const session = await getSession(context);

  // Redirect to login if no session
  if (!session) {
    return {
      redirect: { destination: "/login", permanent: false },
    };
  }

  try {
    const proto = context.req.headers['x-forwarded-proto'] || 'http';
    const host = context.req.headers['host'];
    const inferred = host ? `${proto}://${host}` : null;
    const baseUrl = process.env.NEXTAUTH_URL || inferred || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/tokens/all`);

    if (!res.ok) {
      throw new Error(`Failed to fetch tokens: ${res.statusText}`);
    }

    const data = await res.json();

    return { props: { tokens: Array.isArray(data) ? data : [], session } };
  } catch (err) {
    log.error('Error fetching tokens', { error: err });

    // On error, return empty tokens but keep session
    return { props: { tokens: [], session } };
  }
}