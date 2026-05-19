import { AdminPanel } from '@/components/AdminPanel';
import Link from 'next/link';

export default function AdminPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 gap-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-[0.2em] text-white/80 mb-1">ADMIN</h1>
        <p className="text-xs text-white/20 tracking-widest">wallet-gated access</p>
      </div>

      <AdminPanel />

      <Link href="/" className="text-xs text-white/20 hover:text-white/50 tracking-widest transition">
        ← BACK TO BURN
      </Link>
    </main>
  );
}
