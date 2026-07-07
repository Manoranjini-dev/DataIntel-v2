import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ── Transpile three so its ESM imports resolve cleanly ─────────
  transpilePackages: ['three'],

  // ── Disable all dev caching so stale-chunk 404s never happen ──
  webpack(config, { dev, isServer, webpack }) {
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

    // pptxgenjs (client-side .pptx export) references Node built-ins via the
    // `node:` scheme for its Node code path. In the browser bundle strip the
    // scheme and stub those modules — the browser path uses Blob, not fs.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, https: false, http: false, stream: false, zlib: false,
      };
    }

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

  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}',
    },
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
    ];
  },
};

export default nextConfig;
