import { SessionProvider } from "next-auth/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { mainnet, polygon, optimism, arbitrum, base, sepolia } from "wagmi/chains";
import { queryClientConfig } from "@/lib/web3Config";

// Client-only RainbowKit Provider to avoid SSR interop issues
const RainbowKitProviderNoSSR = dynamic(
  () => import("@rainbow-me/rainbowkit").then((m) => m.RainbowKitProvider),
  { ssr: false }
);

// Create a QueryClient with centralized config
const queryClient = new QueryClient(queryClientConfig);

// SSR-safe Wagmi config built with wagmi connectors
const wagmiConfig = createConfig({
  chains: [
    mainnet,
    polygon,
    optimism,
    arbitrum,
    base,
    ...(process.env.NODE_ENV === "development" ? [sepolia] : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    ...(process.env.NODE_ENV === "development" ? { [sepolia.id]: http() } : {}),
  },
  connectors: [
    injected(),
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID" }),
  ],
  ssr: true,
});

export default function Web3Providers({ session, children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProviderNoSSR>
            {children}
          </RainbowKitProviderNoSSR>
        </WagmiProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}