/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': require.resolve('./lib/empty.js'),
      'pino-pretty': require.resolve('./lib/empty.js'),
    };
    return config;
  },
};

module.exports = nextConfig;
