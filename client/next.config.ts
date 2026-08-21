import type { NextConfig } from 'next';

/**
 * Where the Express API actually lives.
 *
 * Defaulted rather than required, for the same reason the API's CORS list is:
 * a forgotten environment variable should not present itself as a broken app.
 * Override with API_PROXY_TARGET for any other environment.
 *
 * Note this is a *server-side* variable — it is read here at build time and
 * never shipped to the browser.
 */
const API_TARGET =
  process.env.API_PROXY_TARGET ??
  (process.env.NODE_ENV === 'production'
    ? 'https://reneo-c4wy.onrender.com'
    : 'http://localhost:4000');

const nextConfig: NextConfig = {
  /**
   * Proxy the API under this app's own origin.
   *
   * The browser then calls `/api/...` on the Vercel domain, which is
   * same-origin — so there is no preflight and CORS never enters into it. Next
   * forwards the request to the API server-side, where the browser's
   * cross-origin rules do not apply at all.
   *
   * This removes a class of failure rather than configuring around it: the app
   * no longer depends on the API being told which origins to trust. The cost is
   * that API traffic takes an extra hop through Vercel.
   *
   * Authorization and Idempotency-Key are forwarded unchanged, which is what
   * order placement depends on.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_TARGET}/:path*`,
      },
    ];
  },
};

export default nextConfig;
