/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8765";
const STATIC = process.env.NEXT_PUBLIC_DATA_MODE === "static";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = STATIC
  ? {
      // Hosted build: a fully static site. Data comes from public/data, calculators run in the browser.
      reactStrictMode: true,
      output: "export",
      trailingSlash: true,
      basePath: BASE || undefined,
      images: { unoptimized: true },
    }
  : {
      reactStrictMode: true,
      // Local/full build: the browser talks to /api/* on the same origin; Next proxies to the FastAPI service.
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
      },
    };

export default nextConfig;
