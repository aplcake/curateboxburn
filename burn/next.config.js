/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // MetaMask SDK pulls in a React Native dep that doesn't exist in browser builds
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': require.resolve('./lib/empty.js'),
    };
    return config;
  },
};

module.exports = nextConfig;
