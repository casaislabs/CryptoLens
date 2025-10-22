import { fileURLToPath } from 'url';
import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';

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
    const isDev = process.env.NODE_ENV !== 'production';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      !isDev ? 'upgrade-insecure-requests' : null,
    ].filter(Boolean).join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/token/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
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

export default (process.env.SENTRY_DSN ? withSentryConfig(nextConfig, { silent: true }, { hideSourceMaps: true }) : nextConfig);