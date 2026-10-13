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
    // Each of these must stay OUTSIDE the webpack bundle:
    //   @duckdb/node-api            — native .node bindings, resolved at runtime
    //   @modelcontextprotocol/sdk    — subclasses/`require`s to spawn stdio servers
    //   chrome-devtools-mcp          — a spawned child process, not a library
    // Bundling any of them rewrites their module paths and the spawn/load fails
    // at runtime with an opaque error instead of at build time.
    serverComponentsExternalPackages: [
      'puppeteer-extra-plugin-stealth',
      'playwright-extra',
      'playwright',
      'edge-tts',
      'pdf-parse',
      'mammoth',
      'form-data',
      'koffi',
      'screenshot-desktop',
      '@duckdb/node-api',
      '@duckdb/node-bindings',
      '@modelcontextprotocol/sdk',
      'chrome-devtools-mcp',
    ],
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
          // worker-src blob: is load-bearing. The background ticker builds its
          // worker from a Blob URL (src/lib/backgroundTicker.ts) so air-mouse
          // and eye control keep running when the tab is not focused — the
          // browser throttles setTimeout to 1Hz in a background tab, which
          // silently stops tracking the moment you switch to Word or a game.
          // Without this directive Chrome refuses the worker and the ticker
          // quietly falls back to throttled timers.
          value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; worker-src 'self' blob:;",
        },
      ],
    },
    {
      // The MediaPipe runtime and models are ~23MB (11.7MB wasm + 3.7MB face +
      // 7.8MB hand). Served from `public/` they default to `max-age=0`, so every
      // reload re-downloads all of it before eye control / air-mouse can start.
      // These files are content-addressed by version — cache them hard.
      source: '/mediapipe/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
  ],
};

export default nextConfig;
