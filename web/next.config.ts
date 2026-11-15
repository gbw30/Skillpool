import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
// Where the browser sends uploads: the bucket's address, for example
// "https://my-bucket.s3.amazonaws.com https://my-bucket.s3.us-east-1.amazonaws.com".
const uploadOrigin = process.env.UPLOAD_ORIGIN ?? "";

// Every page is prerendered, and a prerendered page cannot carry a per-request nonce, so inline
// scripts and styles are allowed by name. What this policy does stop: scripts, frames and
// requests from or to any other site, and this site being framed.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""} ${uploadOrigin}`.trim(),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        // A private demo: search engines should not list even the access page.
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
      ],
    }];
  },
};

export default nextConfig;
