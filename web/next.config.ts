import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function configuredHttpOrigins(): string[] {
  const urls = [process.env.NEXT_PUBLIC_INDEXER_URL, process.env.NEXT_PUBLIC_LOCAL_RPC_URL, process.env.NEXT_PUBLIC_POLYGON_RPC_URL];
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url ?? "");
      if (parsed.protocol === "http:") origins.add(parsed.origin);
    } catch {
    }
  }
  return [...origins];
}

const LOOPBACK = "http://127.0.0.1:* http://localhost:*";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${LOOPBACK}`,
  "font-src 'self' data: https://fonts.reown.com",
  ["connect-src 'self' https: wss:", LOOPBACK, "ws://127.0.0.1:* ws://localhost:*", ...configuredHttpOrigins()].join(" "),
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@wagmi/walletconnect-connector": path.resolve(
        process.cwd(),
        "node_modules/@wagmi/connectors/dist/esm/walletConnect.js",
      ),
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
