import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, mainnet }    from 'wagmi/chains';
import type { Chain }       from 'wagmi/chains';

// Abstract mainnet (chain ID 2741)
const abstract: Chain = {
  id:        2741,
  name:      'Abstract',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.mainnet.abs.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Abstract Explorer', url: 'https://explorer.mainnet.abs.xyz' },
  },
};

export { abstract };

export const wagmiConfig = getDefaultConfig({
  appName:   'Reveal',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'placeholder',
  chains:    [mainnet, base, abstract],
  ssr:       true,
});
