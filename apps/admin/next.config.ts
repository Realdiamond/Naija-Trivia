import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared contracts ship TypeScript source.
  transpilePackages: ['@whosabi/shared-types'],
  poweredByHeader: false,
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
