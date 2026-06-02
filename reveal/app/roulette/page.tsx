'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { Prize, Burner, Result, RevealState } from '@/lib/types';

// ─── Persist ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'reveal_state_v1';
const loadState = (): RevealState => {
  if (typeof window === 'undefined') return { prizes: [], burners: [], results: [] };
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : { prizes: [], burners: [], results: [] }; }
  catch { return { prizes: [], burners: [], results: [] }; }
};
const saveState = (s: RevealState) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} };

const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

// ─── Roulette ─────────────────────────────────────────────────────────────
const CARD_WIDTH = 164;
const CARD_COUNT = 60;
const WINNER_POS = 45;

function buildStrip(prizes: Prize[], winner: Prize): Prize[] {
  const pool = prizes.length > 1 ? prizes.filter(p => p.id !== winner.id) : prizes;
  const strip: Prize[] = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    strip.push(i === WINNER_POS ? winner : pool[Math.floor(Math.random() * pool.length)]);
  }
  return strip;
}

// ─── OpenSea URL parser ───────────────────────────────────────────────────
const OS_CHAIN_MAP: Record<string, Prize['chain']> = {
  ethereum: 'ethereum', base: 'base', abstract: 'abstract',
  'abstract-mainnet': 'abstract', matic: 'ethereum',
};

function parseOpenSeaUrl(url: string): { contract: string; tokenId: string; chain: Prize['chain'] } | null {
  try {
    // https://opensea.io/item/base/0x.../123
    const m = url.match(/opensea\.io\/item\/([^/]+)\/([^/]+)\/([^/?#]+)/);
    if (!m) return null;
    const chain = OS_CHAIN_MAP[m[1].toLowerCase()];
    if (!chain) return null;
    return { chain, contract: m[2], tokenId: m[3] };
  } catch { return null; }
}

// ─── CSV ──────────────────────────────────────────────────────────────────
const parseCSV = (text: string): Burner[] =>
  text.trim().split('\n').slice(1).map(line => {
    const [wallet, tier, txHash] = line.split(',').map(s => s.replace(/"/g, '').trim());
    return { wallet: wallet.toLowerCase(), tier: parseInt(tier) as 1 | 2, txHash, rolled: false };
  }).filter(b => b.wallet && b.tier && b.txHash);

// ─── Blank prize form ─────────────────────────────────────────────────────
const blankPrize = (): Partial<Prize> => ({ tier: 1, chain: 'ethereum', standard: 'ERC-721' });

export default function RoulettePage() {
  const { address } = useAccount();
  const isAdmin = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  const [state,      setState]      = useState<RevealState>({ prizes: [], burners: [], results: [] });
  const [spinning,   setSpinning]   = useState(false);
  const [strip,      setStrip]      = useState<Prize[]>([]);
  const [winnerIdx,  setWinnerIdx]  = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<Result | null>(null);
  const [rollTier,   setRollTier]   = useState<1 | 2>(2);

  // Prize form
  const [showForm,   setShowForm]   = useState(false);
  const [newPrize,   setNewPrize]   = useState<Partial<Prize>>(blankPrize());
  const [osUrl,      setOsUrl]      = useState('');
  const [osError,    setOsError]    = useState('');
  const [dragOver,   setDragOver]   = useState(false);
  const [keepOpen,   setKeepOpen]   = useState(true); // stay open to add multiple

  const trackRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { if (isAdmin) setState(loadState()); }, [isAdmin]);
  useEffect(() => { if (isAdmin) saveState(state); }, [state, isAdmin]);

  // ── OpenSea parse ─────────────────────────────────────────────────────
  const handleOsUrl = (url: string) => {
    setOsUrl(url);
    setOsError('');
    if (!url.includes('opensea.io')) return;
    const parsed = parseOpenSeaUrl(url);
    if (parsed) {
      setNewPrize(prev => ({ ...prev, contract: parsed.contract, tokenId: parsed.tokenId, chain: parsed.chain }));
    } else {
      setOsError('Could not parse — try: opensea.io/item/base/0x.../123');
    }
  };

  // ── Image handling (input + drag-drop) ───────────────────────────────
  const applyImageFile = (file: File) => {
    const url = URL.createObjectURL(file);
    // Auto-name from filename if no name yet
    const nameFromFile = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    setNewPrize(prev => ({
      ...prev,
      imageUrl: url,
      name: prev.name || nameFromFile,
    }));
  };

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyImageFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) applyImageFile(file);
  };

  // ── Add prize ─────────────────────────────────────────────────────────
  const addPrizeSubmit = () => {
    if (!newPrize.name || !newPrize.imageUrl || !newPrize.contract || !newPrize.tokenId) return;
    const prize: Prize = {
      id:          crypto.randomUUID(),
      name:        newPrize.name!,
      imageUrl:    newPrize.imageUrl!,
      tier:        (newPrize.tier ?? 1) as 1 | 2,
      chain:       newPrize.chain as Prize['chain'],
      contract:    newPrize.contract!,
      tokenId:     newPrize.tokenId!,
      standard:    (newPrize.standard ?? 'ERC-721') as Prize['standard'],
      assigned:    false,
      distributed: false,
    };
    setState(prev => ({ ...prev, prizes: [...prev.prizes, prize] }));
    // Reset for next entry
    setNewPrize(blankPrize());
    setOsUrl('');
    setOsError('');
    if (!keepOpen) setShowForm(false);
  };

  // ── CSV upload ────────────────────────────────────────────────────────
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setState(prev => ({ ...prev, burners: parseCSV(ev.target?.result as string) }));
    };
    reader.readAsText(file);
  };

  // ── Roll ──────────────────────────────────────────────────────────────
  const roll = useCallback(() => {
    const { prizes, burners } = stateRef.current;
    const availPrizes  = prizes.filter(p => !p.assigned && p.tier === rollTier);
    const availBurners = burners.filter(b => !b.rolled && b.tier === rollTier);
    const allPrizes    = prizes.filter(p => p.tier === rollTier);

    if (availPrizes.length === 0)  { alert('No unassigned prizes for this tier!'); return; }
    if (availBurners.length === 0) { alert('No unrolled burners for this tier!');  return; }
    if (allPrizes.length < 3)      { alert('Add at least 3 prizes for this tier to make the wheel look good!'); return; }

    const winner   = availBurners[Math.floor(Math.random() * availBurners.length)];

    // For tier 1: exclude collections this wallet has already won
    let prizePool = availPrizes;
    if (rollTier === 1) {
      const wonContracts = new Set(
        stateRef.current.results
          .filter(r => r.wallet === winner.wallet)
          .map(r => r.prize.contract.toLowerCase())
      );
      const nodupes = availPrizes.filter(p => !wonContracts.has(p.contract.toLowerCase()));
      // Fall back to full pool only if literally every remaining prize is a dupe
      prizePool = nodupes.length > 0 ? nodupes : availPrizes;
    }

    const prize    = prizePool[Math.floor(Math.random() * prizePool.length)];
    const newStrip = buildStrip(allPrizes, prize);

    setStrip(newStrip);
    setWinnerIdx(null);
    setSpinning(true);
    setLastResult(null);

    const viewportCenter = 800 / 2;
    const targetPx = WINNER_POS * CARD_WIDTH - viewportCenter + CARD_WIDTH / 2;

    if (trackRef.current) {
      trackRef.current.style.transition = 'none';
      trackRef.current.style.transform  = 'translateX(0)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!trackRef.current) return;
        trackRef.current.style.transition = 'transform 7s cubic-bezier(0.12, 0, 0.08, 1)';
        trackRef.current.style.transform  = `translateX(-${targetPx}px)`;
      }));
    }

    setTimeout(() => {
      setWinnerIdx(WINNER_POS);
      setSpinning(false);
      const result: Result = {
        id: crypto.randomUUID(), wallet: winner.wallet,
        tier: rollTier, prize, rolledAt: new Date().toISOString(), sent: false,
      };
      setState(prev => ({
        prizes:  prev.prizes.map(p  => p.id === prize.id         ? { ...p, assigned: true }  : p),
        burners: prev.burners.map(b => b.wallet === winner.wallet && b.tier === rollTier
                                         ? { ...b, rolled: true } : b),
        results: [...prev.results, result],
      }));
      setLastResult(result);
    }, 7200);
  }, [rollTier]);

  // ── Export ────────────────────────────────────────────────────────────
  const exportResults = () => {
    const rows = [
      'wallet,tier,prize_name,contract,token_id,chain,standard,rolled_at',
      ...state.results.map(r =>
        `${r.wallet},${r.tier},"${r.prize.name}",${r.prize.contract},${r.prize.tokenId},${r.prize.chain},${r.prize.standard},"${r.rolledAt}"`),
    ].join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([rows], { type: 'text/csv' })),
      download: 'results.csv',
    });
    a.click();
  };

  const resetAll = () => {
    if (!confirm('Reset ALL state?')) return;
    const fresh = { prizes: [], burners: [], results: [] };
    setState(fresh); saveState(fresh);
  };

  const t1All   = state.prizes.filter(p => p.tier === 1);
  const t2All   = state.prizes.filter(p => p.tier === 2);
  const t1Avail = t1All.filter(p => !p.assigned).length;
  const t2Avail = t2All.filter(p => !p.assigned).length;
  const b1Avail = state.burners.filter(b => !b.rolled && b.tier === 1).length;
  const b2Avail = state.burners.filter(b => !b.rolled && b.tier === 2).length;
  const formReady = !!(newPrize.name && newPrize.imageUrl && newPrize.contract && newPrize.tokenId);

  if (!address || !isAdmin) return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">REVEAL</h1>
      <ConnectButton />
      {address && <p className="text-red-400/60 text-xs">Not an admin wallet.</p>}
    </main>
  );

  return (
    <main className="min-h-screen flex flex-col gap-6 p-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-[0.2em] text-gold">REVEAL</h1>
        <div className="flex items-center gap-4">
          <ConnectButton showBalance={false} chainStatus="icon" />
          <a href="/distribute" className="text-xs text-white/40 underline hover:text-white/70">distribute →</a>
        </div>
      </div>

      {/* Tier explainer */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="panel border-orange-900/40">
          <p className="text-orange-300 font-bold tracking-widest mb-1">TIER 1 — BURN ×1 PRIZES</p>
          <p className="text-white/40">Your 15 commissioned NFTs + GlowBuds. Add them all here — each roll picks one randomly for a ×1 burner.</p>
          <p className="text-white/60 mt-2">{t1All.length} prizes · {b1Avail} burners waiting</p>
        </div>
        <div className="panel border-yellow-900/40">
          <p className="text-yellow-300 font-bold tracking-widest mb-1">TIER 2 — BURN ×2 PRIZES</p>
          <p className="text-white/40">Your 5 special ETH mainnet NFTs. Add all 5 here — each roll picks one for a ×2 burner.</p>
          <p className="text-white/60 mt-2">{t2All.length} prizes · {b2Avail} burners waiting</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left panel ── */}
        <div className="flex flex-col gap-4">

          {/* CSV */}
          <div className="panel">
            <p className="text-xs text-white/40 tracking-widest mb-3">BURNERS CSV</p>
            <label className="block cursor-pointer border border-white/20 hover:border-white/40
                              text-xs text-center py-3 tracking-widest transition text-white/60">
              {state.burners.length > 0
                ? `${state.burners.length} loaded — click to replace`
                : 'UPLOAD burns.csv'}
              <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
            </label>
            {state.burners.length > 0 && (
              <div className="mt-3 max-h-32 overflow-y-auto flex flex-col gap-1">
                {state.burners.map((b, i) => (
                  <div key={i} className={`flex justify-between text-[10px] px-2 py-0.5 rounded
                    ${b.rolled ? 'text-white/20 line-through' : 'text-white/50'}`}>
                    <span>{b.wallet.slice(0,6)}…{b.wallet.slice(-4)}</span>
                    <span className={b.tier === 2 ? 'tag-tier2' : 'tag-tier1'}>×{b.tier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prize pool */}
          <div className="panel">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 tracking-widest">PRIZE POOL</p>
              <button onClick={() => setShowForm(!showForm)}
                className="text-[10px] text-gold/70 border border-gold/30 px-2 py-0.5 hover:border-gold/60 transition">
                {showForm ? '− CLOSE' : '+ ADD PRIZE'}
              </button>
            </div>

            {/* ── Add prize form ── */}
            {showForm && (
              <div className="flex flex-col gap-2 mb-4 p-3 border border-gold/20 rounded bg-gold/5">

                {/* OpenSea URL */}
                <div>
                  <p className="text-[10px] text-white/30 mb-1 tracking-widest">OPENSEA URL (auto-fills fields)</p>
                  <input
                    placeholder="https://opensea.io/item/base/0x.../123"
                    className="w-full bg-transparent border border-white/20 px-2 py-1.5 text-[11px] text-white
                               focus:border-gold/50 outline-none transition"
                    value={osUrl}
                    onChange={e => handleOsUrl(e.target.value)}
                  />
                  {osError && <p className="text-[10px] text-red-400 mt-1">{osError}</p>}
                  {newPrize.contract && (
                    <p className="text-[10px] text-gold/60 mt-1">
                      ✓ {newPrize.chain} · {newPrize.contract.slice(0,10)}… · #{newPrize.tokenId}
                    </p>
                  )}
                </div>

                <div className="border-t border-white/10 my-1" />

                {/* Drag-drop image */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`relative border-2 border-dashed transition text-center py-4 cursor-pointer
                    ${dragOver ? 'border-gold/60 bg-gold/10' : 'border-white/20 hover:border-white/40'}`}
                >
                  {newPrize.imageUrl ? (
                    <div className="flex items-center justify-center gap-3">
                      <img src={newPrize.imageUrl} alt="" className="w-12 h-12 object-cover rounded" />
                      <span className="text-[10px] text-white/50">drag new image to replace</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-white/40">
                      drag & drop image here<br />
                      <span className="text-white/25">jpg · png · webp · gif</span>
                    </p>
                  )}
                  <label className="absolute inset-0 cursor-pointer">
                    <input type="file" accept="image/*,.webp" className="hidden" onChange={handleImageInput} />
                  </label>
                </div>

                {/* Name */}
                <input
                  placeholder="Prize name"
                  className="bg-transparent border border-white/20 px-2 py-1.5 text-[11px] text-white
                             focus:border-gold/50 outline-none transition"
                  value={newPrize.name || ''}
                  onChange={e => setNewPrize(p => ({ ...p, name: e.target.value }))}
                />

                {/* Tier + chain */}
                <div className="grid grid-cols-2 gap-2">
                  <select className="bg-ash-mid border border-white/20 px-2 py-1.5 text-[11px] text-white"
                    value={newPrize.tier}
                    onChange={e => setNewPrize(p => ({ ...p, tier: parseInt(e.target.value) as 1|2 }))}>
                    <option value={1}>Tier 1 (×1 burners)</option>
                    <option value={2}>Tier 2 (×2 burners)</option>
                  </select>
                  <select className="bg-ash-mid border border-white/20 px-2 py-1.5 text-[11px] text-white"
                    value={newPrize.chain}
                    onChange={e => setNewPrize(p => ({ ...p, chain: e.target.value as Prize['chain'] }))}>
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                    <option value="abstract">Abstract</option>
                  </select>
                </div>

                {/* Contract + token ID (manual fallback) */}
                <input
                  placeholder="Contract (0x…) — auto-filled from OpenSea URL"
                  className="bg-transparent border border-white/20 px-2 py-1.5 text-[11px] text-white
                             focus:border-white/40 outline-none transition"
                  value={newPrize.contract || ''}
                  onChange={e => setNewPrize(p => ({ ...p, contract: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Token ID"
                    className="bg-transparent border border-white/20 px-2 py-1.5 text-[11px] text-white
                               focus:border-white/40 outline-none transition"
                    value={newPrize.tokenId || ''}
                    onChange={e => setNewPrize(p => ({ ...p, tokenId: e.target.value }))} />
                  <select className="bg-ash-mid border border-white/20 px-2 py-1.5 text-[11px] text-white"
                    value={newPrize.standard}
                    onChange={e => setNewPrize(p => ({ ...p, standard: e.target.value as Prize['standard'] }))}>
                    <option>ERC-721</option>
                    <option>ERC-1155</option>
                  </select>
                </div>

                {/* Stay open toggle */}
                <label className="flex items-center gap-2 text-[10px] text-white/40 cursor-pointer select-none">
                  <input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)}
                    className="accent-yellow-500" />
                  keep form open after adding (batch mode)
                </label>

                <button
                  onClick={addPrizeSubmit}
                  disabled={!formReady}
                  className="py-2 bg-gold/10 border border-gold/40 text-gold text-[11px] tracking-widest
                             hover:bg-gold/20 transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ADD PRIZE {newPrize.tier === 1 ? '(TIER 1)' : '(TIER 2)'}
                </button>
              </div>
            )}

            {/* Prize list split by tier */}
            {[2, 1].map(tier => {
              const list = state.prizes.filter(p => p.tier === tier);
              if (list.length === 0) return null;
              return (
                <div key={tier} className="mb-3">
                  <p className={`text-[10px] tracking-widest mb-1.5 ${tier === 2 ? 'text-yellow-300/60' : 'text-orange-300/60'}`}>
                    TIER {tier} — {list.filter(p => !p.assigned).length}/{list.length} available
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {list.map(p => (
                      <div key={p.id} className={`flex items-center gap-2 p-1.5 rounded border
                        ${p.assigned ? 'border-white/5 opacity-35' : 'border-white/10'}`}>
                        <img src={p.imageUrl} alt={p.name} className="w-7 h-7 object-cover rounded flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white truncate">{p.name}</p>
                          <p className="text-[9px] text-white/25">{p.chain} · #{p.tokenId}</p>
                        </div>
                        {p.assigned
                          ? <span className="text-[9px] text-white/25">rolled</span>
                          : <button onClick={() => setState(prev => ({ ...prev, prizes: prev.prizes.filter(x => x.id !== p.id) }))}
                              className="text-white/20 hover:text-red-400 text-xs flex-shrink-0">✕</button>
                        }
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {state.prizes.length === 0 && (
              <p className="text-white/20 text-xs text-center py-4">no prizes yet</p>
            )}
          </div>
        </div>

        {/* ── Center: Roulette + controls ── */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Wheel */}
          <div className="panel">
            <div className="relative overflow-hidden h-[220px]">
              <div className="absolute inset-y-0 left-0 w-24 roulette-fade-left z-10 pointer-events-none" />
              <div className="absolute inset-y-0 right-0 w-24 roulette-fade-right z-10 pointer-events-none" />
              <div className="roulette-marker" />
              <div className="absolute inset-0 flex items-center px-4">
                <div ref={trackRef} className="flex gap-1" style={{ transform: 'translateX(0)' }}>
                  {strip.length > 0 ? strip.map((prize, i) => (
                    <div key={i} className={`roulette-card ${i === winnerIdx ? 'winner' : ''}`}
                         style={{ background: '#1a1a1a' }}>
                      <img src={prize.imageUrl} alt={prize.name} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 py-1 px-2">
                        <p className="text-[10px] text-white text-center truncate">{prize.name}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center text-white/20 text-xs tracking-widest"
                         style={{ width: 800 }}>
                      ADD PRIZES & BURNERS TO START
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Winner */}
            {lastResult && !spinning && (
              <div className="mt-4 p-4 border border-gold/40 bg-gold/5 text-center fade-in">
                <p className="text-xs text-white/40 tracking-widest mb-1">WINNER</p>
                <p className="text-gold font-bold text-lg">
                  {lastResult.wallet.slice(0,6)}…{lastResult.wallet.slice(-4)}
                </p>
                <p className="text-white/70 text-sm mt-1">🎁 {lastResult.prize.name}</p>
                <p className="text-[10px] text-white/30 mt-1">
                  {lastResult.prize.chain} · #{lastResult.prize.tokenId}
                </p>
              </div>
            )}
          </div>

          {/* Roll controls */}
          <div className="flex gap-4 items-center justify-center">
            <div className="flex border border-white/20 text-xs">
              {([2, 1] as const).map(t => (
                <button key={t} onClick={() => setRollTier(t)}
                  className={`px-5 py-2 tracking-widest transition
                    ${rollTier === t ? 'bg-gold/20 text-gold' : 'text-white/40 hover:text-white/60'}`}>
                  TIER {t} ({t === 2 ? `${b2Avail} left` : `${b1Avail} left`})
                </button>
              ))}
            </div>
            <button onClick={roll} disabled={spinning}
              className="px-10 py-3 bg-gold text-black font-bold tracking-widest text-sm
                         hover:bg-yellow-400 transition disabled:opacity-40 disabled:cursor-not-allowed">
              {spinning ? 'ROLLING…' : 'ROLL'}
            </button>
          </div>

          {/* Results */}
          {state.results.length > 0 && (
            <div className="panel">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-white/40 tracking-widest">RESULTS ({state.results.length})</p>
                <button onClick={exportResults}
                  className="text-[10px] text-gold/60 border border-gold/30 px-2 py-0.5 hover:border-gold/60 transition">
                  EXPORT CSV
                </button>
              </div>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {[...state.results].reverse().map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2 border border-white/5 rounded fade-in">
                    <img src={r.prize.imageUrl} alt={r.prize.name} className="w-10 h-10 object-cover rounded" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white font-bold truncate">{r.prize.name}</p>
                      <p className="text-[10px] text-white/40">{r.wallet.slice(0,8)}…{r.wallet.slice(-4)}</p>
                    </div>
                    <span className={r.tier === 2 ? 'tag-tier2' : 'tag-tier1'}>×{r.tier}</span>
                    <span className={`text-[10px] ${r.sent ? 'text-green-400' : 'text-white/30'}`}>
                      {r.sent ? '✓' : 'pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={resetAll} className="text-[10px] text-white/20 underline hover:text-red-400">
              reset all state
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
