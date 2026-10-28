import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared contracts ship TypeScript source.
  transpilePackages: ['@whosabi/shared-types'],
  poweredByHeader: false,
  // A question-bank category file is a few hundred kilobytes (the default limit is 1 MB).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  // Staff only (doc 18 §16): never indexed, never framed, no referrer leaking player ids.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default config;
