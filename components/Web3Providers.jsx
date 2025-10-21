import { SessionProvider } from "next-auth/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, polygon, optimism, arbitrum, base } from "wagmi/chains";
import { queryClientConfig } from "@/lib/web3Config";
import { useEffect, useState } from "react";

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

  // Build full Wagmi config with connectors in client to avoid SSR ESM issues
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { injected, walletConnect } = await import("wagmi/connectors");
        const cfg = createConfig({
          chains: baseChains,
          transports: baseTransports,
          connectors: [
            injected(),
            walletConnect({ projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID" }),
          ],
          ssr: true,
        });
        if (mounted) setClientWagmiConfig(cfg);
      } catch (e) {
        console.error("Failed to initialize client Wagmi config:", e);
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