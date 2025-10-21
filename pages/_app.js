// pages/_app.js
import "@/styles/globals.css";
import '@rainbow-me/rainbowkit/styles.css';
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { WagmiProvider } from 'wagmi';
import {
  QueryClientProvider,
  QueryClient,
} from "@tanstack/react-query";
import Head from "next/head";
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { mainnet, polygon, optimism, arbitrum, base, sepolia } from 'wagmi/chains';
import { queryClientConfig } from '@/lib/web3Config';

// Create QueryClient instance with centralized configuration
const queryClient = new QueryClient(queryClientConfig);

// Load RainbowKitProvider only on the client to avoid SSR CJS/ESM interop issues
const RainbowKitProviderNoSSR = dynamic(
  () => import('@rainbow-me/rainbowkit').then((m) => m.RainbowKitProvider),
  { ssr: false }
);

export default function App({ Component, pageProps }) {
  const [wagmiConfig, setWagmiConfig] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getDefaultConfig } = await import('@rainbow-me/rainbowkit');
        const cfg = getDefaultConfig({
          appName: 'Web3 Dashboard',
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
          chains: [
            mainnet,
            polygon,
            optimism,
            arbitrum,
            base,
            ...(process.env.NODE_ENV === 'development' ? [sepolia] : []),
          ],
          ssr: true,
        });
        if (mounted) setWagmiConfig(cfg);
      } catch (e) {
        console.error('Failed to load RainbowKit config:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={pageProps.session}>
        <Head>
          <title>CryptoLens</title>
          <meta name="description" content="CryptoLens — Web3 dashboard to explore crypto tokens, track prices, and manage favorites." />
          <meta name="keywords" content="CryptoLens, crypto, cryptocurrency, tokens, Web3, DeFi, blockchain, price tracking, portfolio, favorites" />
          <meta name="robots" content="index,follow" />
          <meta property="og:title" content="CryptoLens" />
          <meta property="og:description" content="Explore crypto tokens, track prices, and manage favorites with CryptoLens." />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://cryptolens.casaislabs.com/" />
          <meta property="og:image" content="/globe.svg" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="CryptoLens" />
          <meta name="twitter:description" content="Explore crypto tokens, track prices, and manage favorites with CryptoLens." />
          <meta name="twitter:image" content="/globe.svg" />
          <meta name="theme-color" content="#0b0f13" />
          <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" sizes="any" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <link rel="canonical" href="https://cryptolens.casaislabs.com/" />
        </Head>
        {wagmiConfig ? (
          <WagmiProvider config={wagmiConfig}>
            <RainbowKitProviderNoSSR>
              <Component {...pageProps} />
              <Toaster />
            </RainbowKitProviderNoSSR>
          </WagmiProvider>
        ) : (
          <>
            <Component {...pageProps} />
            <Toaster />
          </>
        )}
      </SessionProvider>
    </QueryClientProvider>
  );
}
