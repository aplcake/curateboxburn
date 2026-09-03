/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { webpack }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': require.resolve('./lib/empty.js'),
      'pino-pretty': require.resolve('./lib/empty.js'),
      '@x402/evm': require.resolve('./lib/empty.js'),
    };
    // Coinbase cdp-sdk (via wagmi's baseAccount connector) imports @x402/*
    // payment modules that aren't published on npm — unused by this app.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@x402\//, require.resolve('./lib/empty.js'))
    );
    return config;
  },
};

module.exports = nextConfig;
