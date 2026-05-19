import { BurnInterface } from '@/components/BurnInterface';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 gap-12">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-5xl md:text-7xl font-bold tracking-[0.15em] text-burn flicker mb-3">
          BURN
        </h1>
        <p className="text-white/30 text-xs tracking-[0.3em] uppercase">
          Base Network · Token Burn Event
        </p>
      </div>

      {/* Interface */}
      <BurnInterface />

      {/* Footer */}
      <div className="flex gap-6 text-xs text-white/20 tracking-widest">
        <a href="https://basescan.org/address/0x04619852f38ebec22bb94ef36b99351db9900194"
           target="_blank" rel="noreferrer" className="hover:text-white/50 transition">
          CONTRACT ↗
        </a>
        <Link href="/admin" className="hover:text-white/50 transition">ADMIN</Link>
      </div>
    </main>
  );
}
