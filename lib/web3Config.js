// lib/web3Config.js
// Note: Avoid importing '@rainbow-me/rainbowkit' here to prevent SSR issues.

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

// Validation utilities
export const validateWalletAddress = (address) => {
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
};

export const formatWalletAddress = (address, startLength = 6, endLength = 4) => {
  if (!address || !validateWalletAddress(address)) return '';
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
};

// Supported networks configuration (metadata only)
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