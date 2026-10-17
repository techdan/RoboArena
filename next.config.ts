import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second local player use http://127.0.0.1:3000, whose separate
  // localStorage holds its own room seat token.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
