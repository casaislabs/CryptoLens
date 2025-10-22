// pages/_app.js
import "@/styles/globals.css";
import '@rainbow-me/rainbowkit/styles.css';
import { Toaster } from "@/components/ui/sonner";
import Head from "next/head";
import Web3Providers from "@/components/Web3Providers";
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    const handleRouteChangeError = (err, url) => {
      if (err?.cancelled) return; // ignore aborted prefetch
      // Fallback duro si el cambio de ruta falla
      if (typeof window !== 'undefined') window.location.assign(url);
    };

    router.events.on('routeChangeError', handleRouteChangeError);
    return () => {
      router.events.off('routeChangeError', handleRouteChangeError);
    };
  }, [router.events]);

  return (
    <Web3Providers session={pageProps.session}>
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
      <Component key={router.asPath} {...pageProps} />
      <Toaster />
    </Web3Providers>
  );
}
