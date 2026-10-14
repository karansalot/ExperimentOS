/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8765";

const nextConfig = {
  reactStrictMode: true,
  // The browser talks to /api/* on the same origin; Next proxies to the FastAPI service.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
