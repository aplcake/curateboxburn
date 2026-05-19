'use client';

import { useEffect }     from 'react';
import { useRouter }     from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount }    from 'wagmi';

const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

export default function GatePage() {
  const { address } = useAccount();
  const router      = useRouter();
  const isAdmin     = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  useEffect(() => {
    if (isAdmin) router.push('/roulette');
  }, [isAdmin, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8">
      <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">REVEAL</h1>
      <p className="text-white/30 text-xs tracking-widest">ADMIN ACCESS ONLY</p>
      <ConnectButton />
      {address && !isAdmin && (
        <p className="text-red-400/70 text-xs">Not an admin wallet.</p>
      )}
    </main>
  );
}
