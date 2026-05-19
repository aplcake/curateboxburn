/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Expose ADMIN_WALLETS to server-side API routes only (not client)
};

module.exports = nextConfig;
