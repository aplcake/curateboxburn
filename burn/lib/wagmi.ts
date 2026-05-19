import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';

export const wagmiConfig = getDefaultConfig({
  appName:   'Burn',
  // Fallback prevents build-time throw; real value must be set in Vercel env vars
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'placeholder',
  chains:    [base],
  ssr:       true,
});
