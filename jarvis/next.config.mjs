/** @type {import('next').NextConfig} */
const nextConfig = {
  // `ws` (used by Playwright for the Chrome DevTools socket) swaps its pure-JS
  // buffer codec for the optional NATIVE `bufferutil` binding, deciding with a
  // try/catch around require(). Webpack resolves that optional native module to
  // a stub instead of throwing, so the native branch is taken and every socket
  // frame >= 32 bytes dies with "bufferUtil.unmask is not a function" — inside
  // ws, as an uncaught exception. That killed the DevTools connection mid-run,
  // which is what made attaching to Chrome time out or hang for minutes.
  // WS_NO_BUFFER_UTIL is ws's own supported escape hatch back to the JS codec;
  // the native path is only a minor speedup and must never be load-bearing.
  env: {
    WS_NO_BUFFER_UTIL: "1",
  },
  experimental: {
    instrumentationHook: true, // enables src/instrumentation.ts (watcher heartbeat)
    serverComponentsExternalPackages: ['puppeteer-extra-plugin-stealth', 'playwright-extra', 'playwright', 'edge-tts', 'pdf-parse', 'mammoth', 'form-data', 'koffi', 'screenshot-desktop'],
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
          value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: ws: wss:;",
        },
      ],
    },
  ],
};

export default nextConfig;
