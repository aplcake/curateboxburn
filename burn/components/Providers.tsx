'use client';

import { useState }                              from 'react';
import { RainbowKitProvider, darkTheme }         from '@rainbow-me/rainbowkit';
import { WagmiProvider }                          from 'wagmi';
import { QueryClient, QueryClientProvider }       from '@tanstack/react-query';
import { wagmiConfig }                            from '@/lib/wagmi';
import '@rainbow-me/rainbowkit/styles.css';

export function Providers({ children }: { children: React.ReactNode }) {
  // useState ensures a single QueryClient instance per component lifecycle
  // (module-level singleton causes hydration mismatches)
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor:           '#ff4400',
            accentColorForeground: 'white',
            borderRadius:          'small',
            fontStack:             'system',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
