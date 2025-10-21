import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure these external packages are transpiled (ESM/CJS interop)
  transpilePackages: [
    '@vanilla-extract/sprinkles',
    '@rainbow-me/rainbowkit',
  ],
  // Disable cache for dynamic pages
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
  },
  // Configure headers to prevent browser caching
  async headers() {
    return [
      {
        source: '/token/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
      },
      {
        protocol: 'https',
        hostname: 's2.coinmarketcap.com', // Added for CoinMarketCap
      },

    ],
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, '.');
    // Removed alias override for '@vanilla-extract/sprinkles/createUtils' to avoid circular import issues
    return config;
  },
};

export default nextConfig;