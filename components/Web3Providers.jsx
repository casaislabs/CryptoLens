import { SessionProvider } from "next-auth/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, polygon, optimism, arbitrum, base } from "wagmi/chains";
import { queryClientConfig } from "@/lib/web3Config";
import { useEffect, useState } from "react";
import { createLogger } from '@/lib/logger';
const log = createLogger('client:web3');

// Client-only RainbowKit Provider to avoid SSR interop issues
const RainbowKitProviderNoSSR = dynamic(
  () => import("@rainbow-me/rainbowkit").then((m) => m.RainbowKitProvider),
  { ssr: false }
);

// Create a QueryClient with centralized config
const queryClient = new QueryClient(queryClientConfig);

// Shared chains and transports to avoid duplication
const baseChains = [
  mainnet,
  polygon,
  optimism,
  arbitrum,
  base,
];
const baseTransports = baseChains.reduce((acc, chain) => {
  acc[chain.id] = http();
  return acc;
}, {});

// SSR-safe Wagmi config (no connectors) to satisfy hooks during prerender
const ssrWagmiConfig = createConfig({
  chains: baseChains,
  transports: baseTransports,
  ssr: true,
});

export default function Web3Providers({ session, children }) {
  const [clientWagmiConfig, setClientWagmiConfig] = useState(null);

  // Build full Wagmi config with RainbowKit connectors in client
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Use RainbowKit's connectors so the modal can list wallets properly
        const { getDefaultWallets } = await import("@rainbow-me/rainbowkit");
        const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
        const { connectors } = getDefaultWallets({
          appName: "CryptoLens",
          projectId: projectId || "",
          chains: baseChains,
        });

        const cfg = createConfig({
          chains: baseChains,
          transports: baseTransports,
          connectors,
          ssr: true,
        });
        if (mounted) setClientWagmiConfig(cfg);
      } catch (e) {
        log.error('Failed to initialize client Wagmi config', { error: e });
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <WagmiProvider config={clientWagmiConfig || ssrWagmiConfig}>
          <RainbowKitProviderNoSSR>
            {children}
          </RainbowKitProviderNoSSR>
        </WagmiProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}