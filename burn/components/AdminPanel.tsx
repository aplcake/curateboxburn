'use client';

import { useState, useEffect } from 'react';
import { useAccount }           from 'wagmi';
import { adminAction, downloadCSV, getStatus, setEventLive, type BurnStatus } from '@/lib/api';

const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

export function AdminPanel() {
  const { address } = useAccount();
  const isAdmin     = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  const [status,  setStatus]  = useState<BurnStatus | null>(null);
  const [loading, setLoading] = useState('');
  const [msg,     setMsg]     = useState('');
  const [reminting, setReminting] = useState(false);
  const [liveToggling, setLiveToggling] = useState(false);

  const refresh = async () => { try { setStatus(await getStatus()); } catch {} };
  useEffect(() => { refresh(); }, []);

  if (!address)  return <p className="text-white/30 text-sm">Connect wallet to access admin.</p>;
  if (!isAdmin)  return <p className="text-red-500/60 text-sm">Not an admin wallet.</p>;

  const remintAll = async () => {
    setReminting(true);
    setMsg('');
    try {
      const r = await fetch('/api/admin/remint', { method: 'POST' });
      const data = await r.json();
      const ok  = data.results?.filter((x: { status: string }) => x.status === 'minted').length ?? 0;
      const fail = data.results?.filter((x: { status: string }) => x.status === 'failed').length ?? 0;
      setMsg(`Remint done: ${ok} minted, ${fail} failed`);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setReminting(false);
    }
  };

  const toggleEventLive = async () => {
    if (!status) return;
    setLiveToggling(true);
    setMsg('');
    try {
      await setEventLive(!status.eventLive);
      setMsg(status.eventLive ? 'Switched to COMING SOON ✓' : 'Event is now LIVE 🚀');
      await refresh();
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setLiveToggling(false);
    }
  };

  const toggle = async (action: 'open' | 'close') => {
    setLoading(action);
    setMsg('');
    try {
      await adminAction(action);
      setMsg(`Burn 1 ${action === 'open' ? 'opened' : 'closed'} ✓`);
      await refresh();
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-lg">
      <h2 className="text-burn tracking-[0.2em] text-sm font-bold">ADMIN PANEL</h2>

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 gap-3 text-xs text-white/60">
          <div className="stat-box col-span-2 flex justify-between items-center">
            <span>EVENT STATUS</span>
            <span className={status.eventLive ? 'text-green-400' : 'text-yellow-400'}>
              {status.eventLive ? '● LIVE' : '● COMING SOON'}
            </span>
          </div>
          <div className="stat-box">
            <span className="block text-xl text-white font-bold">{status.totalBurn1}</span>
            TOTAL BURN ×1
          </div>
          <div className="stat-box">
            <span className="block text-xl text-burn font-bold">{status.totalBurn2}</span>
            TOTAL BURN ×2
          </div>
          <div className="stat-box col-span-2 flex justify-between items-center">
            <span>BURN 1 STATUS</span>
            <span className={status.burn1Open ? 'text-green-400' : 'text-red-400'}>
              {status.burn1Open ? '● OPEN' : '● CLOSED'}
            </span>
          </div>
          <div className="stat-box col-span-2 flex justify-between items-center">
            <span>BURN 2 STATUS</span>
            <span className={status.burn2Open ? 'text-green-400' : 'text-red-400'}>
              {status.burn2Open ? `● OPEN — ${5 - status.burn2Count}/5 left` : '● FULL'}
            </span>
          </div>
        </div>
      )}

      {/* Event live toggle — single button, label auto-switches to current state's action */}
      <button
        className={`w-full py-3 text-xs tracking-widest transition disabled:opacity-40 border
                    ${status?.eventLive
                      ? 'border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/20'
                      : 'border-green-700/50 text-green-400 hover:bg-green-900/20'}`}
        disabled={liveToggling || !status}
        onClick={toggleEventLive}
      >
        {liveToggling
          ? 'UPDATING…'
          : status?.eventLive
            ? '⏳ SET TO COMING SOON'
            : '🚀 GO LIVE'}
      </button>

      {/* Burn 1 toggle */}
      <div className="flex gap-3">
        <button
          className="flex-1 py-2 border border-green-700/50 text-green-400 text-xs tracking-widest
                     hover:bg-green-900/20 transition disabled:opacity-40"
          disabled={!!loading || status?.burn1Open === true}
          onClick={() => toggle('open')}
        >
          {loading === 'open' ? '…' : 'OPEN BURN 1'}
        </button>
        <button
          className="flex-1 py-2 border border-red-700/50 text-red-400 text-xs tracking-widest
                     hover:bg-red-900/20 transition disabled:opacity-40"
          disabled={!!loading || status?.burn1Open === false}
          onClick={() => toggle('close')}
        >
          {loading === 'close' ? '…' : 'CLOSE BURN 1'}
        </button>
      </div>

      {/* Export */}
      <button
        className="w-full py-3 border border-white/20 text-white/70 text-xs tracking-widest
                   hover:border-white/40 hover:text-white transition"
        onClick={downloadCSV}
      >
        ↓ EXPORT BURNS CSV
      </button>

      {/* Remint airdrop to all recorded burns */}
      <button
        className="w-full py-3 border border-yellow-700/50 text-yellow-400 text-xs tracking-widest
                   hover:bg-yellow-900/20 transition disabled:opacity-40"
        disabled={reminting}
        onClick={remintAll}
      >
        {reminting ? 'MINTING…' : '🔥 REMINT AIRDROP TO ALL BURNS'}
      </button>

      {msg && <p className="text-xs text-center text-white/50">{msg}</p>}
    </div>
  );
}
