/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-extra-plugin-stealth', 'playwright-extra', 'playwright'],
  },
  reactStrictMode: true,
  images: {
    domains: [],
  },
  // Required for Three.js to work properly
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
  // Security headers to prevent extension injection conflicts
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:;",
        },
      ],
    },
  ],
};

export default nextConfig;
