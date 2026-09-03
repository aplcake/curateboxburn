'use client';

import { useState, useEffect } from 'react';
import { useAccount }           from 'wagmi';
import { useConnectModal }      from '@rainbow-me/rainbowkit';
import {
  adminAction, adminBurn2Action, downloadCSV, getStatus, setEventLive,
  getSlideshow, saveSlideshow,
  getStoredAdminKey, storeAdminKey, clearAdminKey, adminHeaders,
  type BurnStatus, type SlideshowSaveResult,
} from '@/lib/api';

const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

function useCountdown(timerEnd: string | null) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!timerEnd) { setRemaining(''); return; }
    const tick = () => {
      const ms = new Date(timerEnd).getTime() - Date.now();
      if (ms <= 0) { setRemaining('EXPIRED'); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setRemaining(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerEnd]);
  return remaining;
}

export function AdminPanel() {
  const { address }        = useAccount();
  const { openConnectModal } = useConnectModal();
  const isAdmin = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  const [status,          setStatus]          = useState<BurnStatus | null>(null);
  const [loading,         setLoading]         = useState('');
  const [msg,             setMsg]             = useState('');
  const [liveToggling,    setLiveToggling]    = useState(false);
  const [timerRunning,    setTimerRunning]    = useState(false);
  const [poolToggling,    setPoolToggling]    = useState(false);
  const [slideshowText,   setSlideshowText]   = useState('');
  const [slideshowSaving, setSlideshowSaving] = useState(false);
  const [slideshowResults,setSlideshowResults]= useState<SlideshowSaveResult[] | null>(null);
  const [adminKey,        setAdminKey]        = useState<string | null>(null);
  const [keyInput,        setKeyInput]        = useState('');

  const countdown = useCountdown(status?.timerEnd ?? null);

  useEffect(() => { setAdminKey(getStoredAdminKey()); }, []);

  const refresh = async () => { try { setStatus(await getStatus()); } catch {} };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    // Re-poll status every 10s so the admin sees timer expiry without reloading
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getSlideshow()
      .then(items => setSlideshowText(items.map(i => i.openseaUrl).join('\n')))
      .catch(() => {});
  }, []);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-white/30 text-sm">Connect wallet to access admin.</p>
        <button
          onClick={openConnectModal ?? (() => {})}
          className="bg-[#17121f] border-2 border-[#d6b55b] text-[#d6b55b] text-xs
                     font-mono tracking-widest px-5 py-2.5 hover:bg-[#d6b55b] hover:text-[#17121f]
                     transition-all"
        >
          CONNECT WALLET
        </button>
      </div>
    );
  }
  if (!isAdmin) return <p className="text-red-500/60 text-sm">Not an admin wallet.</p>;

  // Admin key gate — the key (Railway ADMIN_API_KEY) authorizes every admin
  // call server-side; the wallet check above is only a UI convenience.
  if (!adminKey) {
    return (
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <h2 className="text-burn tracking-[0.2em] text-sm font-bold">ADMIN PANEL</h2>
        <p className="text-xs text-white/40 tracking-wider">
          Enter the admin key (same value as Railway&apos;s ADMIN_API_KEY).
        </p>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && keyInput.trim()) {
              storeAdminKey(keyInput.trim());
              setAdminKey(keyInput.trim());
            }
          }}
          placeholder="admin key"
          className="w-full bg-black/40 border border-white/10 text-white/80 text-xs font-mono
                     p-2.5 tracking-wide placeholder:text-white/20 focus:outline-none focus:border-white/30"
        />
        <button
          className="w-full py-2.5 border border-burn/50 text-burn text-xs tracking-widest
                     hover:bg-burn/10 transition disabled:opacity-40"
          disabled={!keyInput.trim()}
          onClick={() => { storeAdminKey(keyInput.trim()); setAdminKey(keyInput.trim()); }}
        >
          UNLOCK
        </button>
      </div>
    );
  }

  const toggleEventLive = async () => {
    if (!status) return;
    setLiveToggling(true); setMsg('');
    try {
      await setEventLive(!status.eventLive);
      setMsg(status.eventLive ? 'Switched to COMING SOON ✓' : 'Event is now LIVE 🚀');
      await refresh();
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setLiveToggling(false); }
  };

  const handleTimer = async (action: 'start' | 'stop') => {
    setTimerRunning(true); setMsg('');
    try {
      const r    = await fetch(`/api/admin/timer/${action}`, { method: 'POST', headers: adminHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMsg(action === 'start'
        ? `⏱ 24h timer started — burn 1 open until ${new Date(data.timerEnd).toLocaleString()}`
        : '⏹ Timer stopped — burn 1 closed');
      await refresh();
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setTimerRunning(false); }
  };

  const handlePool = async (action: 'start' | 'stop') => {
    setPoolToggling(true); setMsg('');
    try {
      await togglePool(action);
      setMsg(action === 'start' ? '🎟️ Pool open — scanning for tokens every 30s' : '⏹ Pool closed');
      await refresh();
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setPoolToggling(false); }
  };

  const saveSlideshowList = async () => {
    setSlideshowSaving(true); setSlideshowResults(null); setMsg('');
    try {
      const urls    = slideshowText.split('\n').map(u => u.trim()).filter(Boolean);
      const results = await saveSlideshow(urls);
      setSlideshowResults(results);
      setMsg(`Slideshow saved: ${results.filter(r => !r.error).length}/${results.length} resolved`);
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setSlideshowSaving(false); }
  };

  const toggle = async (action: 'open' | 'close') => {
    setLoading(action); setMsg('');
    try {
      await adminAction(action);
      setMsg(`Burn 1 ${action === 'open' ? 'opened' : 'closed'} ✓`);
      await refresh();
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setLoading(''); }
  };

  const toggleBurn2 = async (action: 'open' | 'close') => {
    setLoading(`burn2-${action}`); setMsg('');
    try {
      await adminBurn2Action(action);
      setMsg(`Burn 2 ${action === 'open' ? 'opened' : 'closed'} ✓`);
      await refresh();
    } catch (e: unknown) { setMsg((e as Error).message); }
    finally { setLoading(''); }
  };

  const exportCSV = async () => {
    setMsg('');
    try { await downloadCSV(); }
    catch (e: unknown) { setMsg((e as Error).message); }
  };

  const timerActive = !!status?.timerEnd && status.burn1Open;

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
            <span>BURN 1 — OPEN EDITION</span>
            <span className={status.burn1Open ? 'text-green-400' : 'text-red-400'}>
              {timerActive
                ? `● OPEN — ${countdown} left`
                : status.burn1Open ? '● OPEN' : '● CLOSED'}
            </span>
          </div>
          <div className="stat-box col-span-2 flex justify-between items-center">
            <span>FCFS POOL</span>
            <span className={status.poolOpen ? 'text-green-400' : status.poolBatchSent ? 'text-blue-400' : 'text-white/40'}>
              {status.poolBatchSent
                ? `● COMPLETE — all burned ✓`
                : status.poolOpen
                  ? `● OPEN — ${status.poolCount}/${status.poolMax}`
                  : `● CLOSED — ${status.poolCount}/${status.poolMax}`}
            </span>
          </div>
          <div className="stat-box col-span-2 flex justify-between items-center">
            <span>BURN 2 STATUS</span>
            <span className={status.burn2Open ? 'text-green-400' : 'text-red-400'}>
              {status.burn2Open
                ? `● OPEN — ${5 - status.burn2Count}/5 left`
                : status.burn2Count >= 5 ? '● FULL' : '● CLOSED'}
            </span>
          </div>
        </div>
      )}

      {/* Event live toggle */}
      <button
        className={`w-full py-3 text-xs tracking-widest transition disabled:opacity-40 border
                    ${status?.eventLive
                      ? 'border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/20'
                      : 'border-green-700/50 text-green-400 hover:bg-green-900/20'}`}
        disabled={liveToggling || !status}
        onClick={toggleEventLive}
      >
        {liveToggling ? 'UPDATING…' : status?.eventLive ? '⏳ SET TO COMING SOON' : '🚀 GO LIVE'}
      </button>

      {/* 24h timer — open edition burn 1 */}
      <div className="flex flex-col gap-2 border border-white/10 p-4">
        <p className="text-xs tracking-widest text-white/50 mb-1">
          BURN ×1 — OPEN EDITION 24H TIMER
        </p>
        {timerActive && (
          <p className="text-center text-orange-400 font-mono text-lg tracking-widest">
            {countdown}
          </p>
        )}
        <div className="flex gap-3">
          <button
            className="flex-1 py-2 border border-orange-700/50 text-orange-400 text-xs
                       tracking-widest hover:bg-orange-900/20 transition disabled:opacity-40"
            disabled={timerRunning || timerActive}
            onClick={() => handleTimer('start')}
          >
            {timerRunning ? '…' : '▶ START 24H BURN'}
          </button>
          <button
            className="flex-1 py-2 border border-red-700/50 text-red-400 text-xs
                       tracking-widest hover:bg-red-900/20 transition disabled:opacity-40"
            disabled={timerRunning || !timerActive}
            onClick={() => handleTimer('stop')}
          >
            {timerRunning ? '…' : '⏹ STOP TIMER'}
          </button>
        </div>
        <p className="text-[10px] text-white/30 text-center">
          Starting the timer opens burn ×1 and automatically closes it after 24 hours.
          One mint per wallet — unlimited supply.
        </p>
      </div>

      {/* FCFS Pool */}
      <div className="flex flex-col gap-2 border border-white/10 p-4">
        <p className="text-xs tracking-widest text-white/50 mb-1">
          FCFS POOL — 15 SLOTS (SEND TOKEN TO MINTER WALLET)
        </p>
        {status && (
          <p className="text-center font-mono text-lg">
            <span className={status.poolOpen ? 'text-green-400' : 'text-white/40'}>
              {status.poolCount}/{status.poolMax}
            </span>
            {status.poolBatchSent && <span className="text-blue-400 text-xs ml-3">BATCH BURNED ✓</span>}
          </p>
        )}
        <div className="flex gap-3">
          <button
            className="flex-1 py-2 border border-green-700/50 text-green-400 text-xs
                       tracking-widest hover:bg-green-900/20 transition disabled:opacity-40"
            disabled={poolToggling || !!status?.poolOpen || !!status?.poolBatchSent}
            onClick={() => handlePool('start')}
          >▶ OPEN POOL</button>
          <button
            className="flex-1 py-2 border border-red-700/50 text-red-400 text-xs
                       tracking-widest hover:bg-red-900/20 transition disabled:opacity-40"
            disabled={poolToggling || !status?.poolOpen}
            onClick={() => handlePool('stop')}
          >⏹ CLOSE POOL</button>
        </div>
        <p className="text-[10px] text-white/30 text-center">
          Scans every 30s. Accepted → Manifold NFT instant. Over 15 → auto-returned. Full → batch burn to dead.
        </p>
      </div>

      {/* Manual burn 1 toggle (fallback) */}
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

      {/* Burn 2 toggle */}
      <div className="flex gap-3">
        <button
          className="flex-1 py-2 border border-green-700/50 text-green-400 text-xs tracking-widest
                     hover:bg-green-900/20 transition disabled:opacity-40"
          disabled={!!loading || status?.burn2Open === true}
          onClick={() => toggleBurn2('open')}
        >
          {loading === 'burn2-open' ? '…' : 'OPEN BURN 2'}
        </button>
        <button
          className="flex-1 py-2 border border-red-700/50 text-red-400 text-xs tracking-widest
                     hover:bg-red-900/20 transition disabled:opacity-40"
          disabled={!!loading || status?.burn2Open === false}
          onClick={() => toggleBurn2('close')}
        >
          {loading === 'burn2-close' ? '…' : 'CLOSE BURN 2'}
        </button>
      </div>

      {/* Export */}
      <button
        className="w-full py-3 border border-white/20 text-white/70 text-xs tracking-widest
                   hover:border-white/40 hover:text-white transition"
        onClick={exportCSV}
      >
        ↓ EXPORT BURNS CSV
      </button>

      {/* NFT slideshow */}
      <div className="flex flex-col gap-2 border border-white/10 p-4">
        <p className="text-xs tracking-widest text-white/50">
          NFT SLIDESHOW — paste OpenSea links, one per line
        </p>
        <textarea
          value={slideshowText}
          onChange={(e) => setSlideshowText(e.target.value)}
          placeholder="https://opensea.io/assets/base/0x.../123"
          rows={5}
          className="w-full bg-black/40 border border-white/10 text-white/80 text-xs font-mono
                     p-2 tracking-wide placeholder:text-white/20 focus:outline-none focus:border-white/30"
        />
        <button
          className="w-full py-2 border border-white/20 text-white/70 text-xs tracking-widest
                     hover:border-white/40 hover:text-white transition disabled:opacity-40"
          disabled={slideshowSaving}
          onClick={saveSlideshowList}
        >
          {slideshowSaving ? 'RESOLVING…' : 'SAVE SLIDESHOW'}
        </button>
        {slideshowResults && (
          <div className="flex flex-col gap-1.5 mt-1">
            {slideshowResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                {r.imageUrl
                  ? <img src={r.imageUrl} alt="" className="w-6 h-6 object-contain bg-white/5 flex-shrink-0" />
                  : <div className="w-6 h-6 bg-red-900/30 flex-shrink-0" />}
                <span className={r.error ? 'text-red-400' : 'text-green-400/80'}>
                  {r.error ? `✗ ${r.error}` : `✓ ${r.name || 'OK'}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="text-xs text-center text-white/50">{msg}</p>}

      <button
        className="text-[10px] text-white/20 hover:text-white/50 underline tracking-widest self-center"
        onClick={() => { clearAdminKey(); setAdminKey(null); setKeyInput(''); }}
      >
        change admin key
      </button>
    </div>
  );
}
