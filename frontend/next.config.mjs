/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ── Disable all dev caching so stale-chunk 404s never happen ──
  // 1. Tell webpack NOT to persist its module cache to disk between restarts.
  //    Every restart rebuilds fresh chunks with new hashes that the browser can actually load.
  // 2. Browser-side: serve all _next/static assets with no-store so the
  //    browser never holds on to an old chunk URL after a server restart.
  webpack(config, { dev, webpack }) {
    // Disable webpack filesystem cache in dev
    if (dev) {
      config.cache = false;
    }

    // @xyflow/react requires __VERSION__ to be defined at build time
    config.plugins.push(
      new webpack.DefinePlugin({
        __VERSION__: JSON.stringify('12.10.1'),
      }),
    );
    return config;
  },

  async headers() {
    // In dev, tell the browser: never cache Next.js static chunks.
    // In production the chunks are content-hashed so long-lived caching is fine.
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
      {
        source: '/_next/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
    ];
  },

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      '@xyflow/react',
      'react-markdown',
      'remark-gfm',
      '@tanstack/react-table',
      'react-grid-layout',
    ],
  },

  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}',
    },
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

export default nextConfig;
