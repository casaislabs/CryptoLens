// lib/web3Config.js
import {
  getDefaultConfig,
} from '@rainbow-me/rainbowkit';
import {
  mainnet,
  polygon,
  optimism,
  arbitrum,
  base,
  sepolia,
} from 'wagmi/chains';

// RainbowKit and Wagmi configuration per official docs
export const wagmiConfig = getDefaultConfig({
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

// React Query configuration
export const queryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 10, // 10 minutes
      retry: 3,
      refetchOnWindowFocus: false,
    },
  },
};

// Custom chains configuration (if you need to add more)
export const customChains = {
  // Example custom chain
  // customChain: {
  //   id: 1337,
  //   name: 'Local Chain',
  //   network: 'localhost',
  //   nativeCurrency: {
  //     decimals: 18,
  //     name: 'Ether',
  //     symbol: 'ETH',
  //   },
  //   rpcUrls: {
  //     default: {
  //       http: ['http://127.0.0.1:8545'],
  //     },
  //     public: {
  //       http: ['http://127.0.0.1:8545'],
  //     },
  //   },
  // },
};

// Validation utilities
export const validateWalletAddress = (address) => {
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
};

export const formatWalletAddress = (address, startLength = 6, endLength = 4) => {
  if (!address || !validateWalletAddress(address)) return '';
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
};

// Supported networks configuration
export const supportedNetworks = {
  mainnet: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    blockExplorer: 'https://etherscan.io',
  },
  polygon: {
    name: 'Polygon',
    chainId: 137,
    blockExplorer: 'https://polygonscan.com',
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    blockExplorer: 'https://arbiscan.io',
  },
  base: {
    name: 'Base',
    chainId: 8453,
    blockExplorer: 'https://basescan.org',
  },
};