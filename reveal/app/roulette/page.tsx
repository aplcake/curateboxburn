'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { Prize, Burner, Result, RevealState } from '@/lib/types';

// ─── Persist to localStorage ──────────────────────────────────────────────
const STORAGE_KEY = 'reveal_state_v1';

const loadState = (): RevealState => {
  if (typeof window === 'undefined') return { prizes: [], burners: [], results: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { prizes: [], burners: [], results: [] };
  } catch { return { prizes: [], burners: [], results: [] }; }
};

const saveState = (s: RevealState) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
};

// ─── Admin gate ────────────────────────────────────────────────────────────
const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

// ─── Roulette helpers ──────────────────────────────────────────────────────
const CARD_WIDTH  = 164; // px (160 + 4 gap)
const CARD_COUNT  = 60;  // total cards in strip
const WINNER_POS  = 45;  // index in strip where winner lands
const CENTER_OFFSET = 3; // cards from left edge to center of viewport

function buildStrip(prizes: Prize[], winner: Prize): Prize[] {
  const pool = prizes.filter(p => p.id !== winner.id);
  const strip: Prize[] = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    if (i === WINNER_POS) { strip.push(winner); continue; }
    strip.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return strip;
}

// ─── CSV parser ────────────────────────────────────────────────────────────
const parseCSV = (text: string): Burner[] => {
  const lines = text.trim().split('\n').slice(1); // skip header
  return lines.map(line => {
    const [wallet, tier, txHash] = line.split(',').map(s => s.replace(/"/g, '').trim());
    return { wallet: wallet.toLowerCase(), tier: parseInt(tier) as 1|2, txHash, rolled: false };
  }).filter(b => b.wallet && b.tier && b.txHash);
};

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function RoulettePage() {
  const { address } = useAccount();
  const router      = useRouter();
  const isAdmin     = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  const [state,     setState]     = useState<RevealState>({ prizes: [], burners: [], results: [] });
  const [spinning,  setSpinning]  = useState(false);
  const [strip,     setStrip]     = useState<Prize[]>([]);
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);
  const [lastResult,setLastResult]= useState<Result | null>(null);
  const [rollTier,  setRollTier]  = useState<1|2>(2);
  const [addPrize,  setAddPrize]  = useState(false);
  const [newPrize,  setNewPrize]  = useState<Partial<Prize>>({ tier:2, chain:'ethereum', standard:'ERC-721' });
  const [imageFile, setImageFile] = useState<File | null>(null);

  const trackRef  = useRef<HTMLDivElement>(null);
  const stateRef  = useRef(state);
  stateRef.current = state;

  // Load from localStorage on mount
  useEffect(() => {
    if (!isAdmin) return;
    setState(loadState());
  }, [isAdmin]);

  useEffect(() => { if (isAdmin) saveState(state); }, [state, isAdmin]);

  if (!address) return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">REVEAL</h1>
      <ConnectButton />
    </main>
  );

  if (!isAdmin) return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-red-400/70">Not an admin wallet.</p>
      <button onClick={() => router.push('/')} className="text-xs text-white/30 underline">back</button>
    </main>
  );

  // ── CSV upload ────────────────────────────────────────────────────────────
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const burners = parseCSV(ev.target?.result as string);
      setState(prev => ({ ...prev, burners }));
    };
    reader.readAsText(file);
  };

  // ── Prize image upload ────────────────────────────────────────────────────
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setNewPrize(prev => ({ ...prev, imageUrl: url }));
  };

  const addPrizeSubmit = () => {
    if (!newPrize.name || !newPrize.imageUrl || !newPrize.contract || !newPrize.tokenId) return;
    const prize: Prize = {
      id:          crypto.randomUUID(),
      name:        newPrize.name!,
      imageUrl:    newPrize.imageUrl!,
      tier:        newPrize.tier as 1|2,
      chain:       newPrize.chain as Prize['chain'],
      contract:    newPrize.contract!,
      tokenId:     newPrize.tokenId!,
      standard:    newPrize.standard as Prize['standard'],
      assigned:    false,
      distributed: false,
    };
    setState(prev => ({ ...prev, prizes: [...prev.prizes, prize] }));
    setNewPrize({ tier:2, chain:'ethereum', standard:'ERC-721' });
    setImageFile(null);
    setAddPrize(false);
  };

  const removePrize = (id: string) => {
    setState(prev => ({ ...prev, prizes: prev.prizes.filter(p => p.id !== id) }));
  };

  // ── Roll ──────────────────────────────────────────────────────────────────
  const roll = useCallback(() => {
    const { prizes, burners } = stateRef.current;

    const availPrizes  = prizes.filter(p => !p.assigned && p.tier === rollTier);
    const availBurners = burners.filter(b => !b.rolled && b.tier === rollTier);

    if (availPrizes.length === 0)  { alert('No unassigned prizes for this tier!'); return; }
    if (availBurners.length === 0) { alert('No unrolled burners for this tier!');  return; }
    if (prizes.length < 5)         { alert('Add at least 5 prizes to the pool for the roulette to look good!'); return; }

    const winner = availBurners[Math.floor(Math.random() * availBurners.length)];
    const prize  = availPrizes[Math.floor(Math.random() * availPrizes.length)];
    const newStrip = buildStrip(prizes, prize);

    setStrip(newStrip);
    setWinnerIdx(null);
    setSpinning(true);
    setLastResult(null);

    // Compute spin distance so winner card aligns to center marker
    // Viewport width / 2 - center card position
    const viewportCenter = 800 / 2; // approximate viewport center in px
    const targetPx = WINNER_POS * CARD_WIDTH - viewportCenter + CARD_WIDTH / 2;

    if (trackRef.current) {
      trackRef.current.style.setProperty('--spin-distance', `-${targetPx}px`);
      trackRef.current.style.setProperty('--spin-duration', '7s');
      trackRef.current.style.transition = 'none';
      trackRef.current.style.transform  = 'translateX(0)';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!trackRef.current) return;
          trackRef.current.style.transition =
            'transform 7s cubic-bezier(0.12, 0, 0.08, 1)';
          trackRef.current.style.transform =
            `translateX(-${targetPx}px)`;
        });
      });
    }

    setTimeout(() => {
      setWinnerIdx(WINNER_POS);
      setSpinning(false);

      const result: Result = {
        id:       crypto.randomUUID(),
        wallet:   winner.wallet,
        tier:     rollTier,
        prize,
        rolledAt: new Date().toISOString(),
        sent:     false,
      };

      setState(prev => ({
        ...prev,
        prizes:  prev.prizes.map(p  => p.id === prize.id       ? { ...p,  assigned: true }  : p),
        burners: prev.burners.map(b => b.wallet === winner.wallet && b.tier === rollTier
                                        ? { ...b, rolled: true } : b),
        results: [...prev.results, result],
      }));
      setLastResult(result);
    }, 7200);
  }, [rollTier]);

  // ── Export results CSV ────────────────────────────────────────────────────
  const exportResults = () => {
    const rows = [
      'wallet,tier,prize_name,contract,token_id,chain,standard,rolled_at',
      ...state.results.map(r =>
        `${r.wallet},${r.tier},"${r.prize.name}",${r.prize.contract},${r.prize.tokenId},${r.prize.chain},${r.prize.standard},"${r.rolledAt}"`
      ),
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'results.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    if (!confirm('Reset ALL state? This cannot be undone.')) return;
    const fresh = { prizes: [], burners: [], results: [] };
    setState(fresh);
    saveState(fresh);
  };

  const t1Avail = state.prizes.filter(p => !p.assigned && p.tier === 1).length;
  const t2Avail = state.prizes.filter(p => !p.assigned && p.tier === 2).length;
  const b1Avail = state.burners.filter(b => !b.rolled && b.tier === 1).length;
  const b2Avail = state.burners.filter(b => !b.rolled && b.tier === 2).length;

  return (
    <main className="min-h-screen flex flex-col gap-6 p-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-[0.2em] text-gold">REVEAL</h1>
        <div className="flex items-center gap-4">
          <ConnectButton showBalance={false} chainStatus="icon" />
          <a href="/distribute" className="text-xs text-white/40 underline hover:text-white/70">
            distribute →
          </a>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-3 text-xs text-center text-white/50">
        {[
          ['PRIZES T1', t1Avail,           'text-orange-300'],
          ['PRIZES T2', t2Avail,           'text-yellow-300'],
          ['BURNERS T1', b1Avail,          'text-orange-300'],
          ['BURNERS T2', b2Avail,          'text-yellow-300'],
        ].map(([label, val, col]) => (
          <div key={label as string} className="panel">
            <div className={`text-xl font-bold ${col}`}>{val}</div>
            <div>{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Data setup ── */}
        <div className="flex flex-col gap-4">

          {/* CSV Upload */}
          <div className="panel">
            <p className="text-xs text-white/40 tracking-widest mb-3">BURNERS CSV</p>
            <label className="block cursor-pointer border border-white/20 hover:border-white/40
                              text-xs text-center py-3 px-4 tracking-widest transition text-white/60">
              {state.burners.length > 0
                ? `${state.burners.length} BURNERS LOADED — REPLACE`
                : 'UPLOAD burns.csv'}
              <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
            </label>
            {state.burners.length > 0 && (
              <div className="mt-3 max-h-36 overflow-y-auto flex flex-col gap-1">
                {state.burners.map((b, i) => (
                  <div key={i} className={`flex justify-between text-[10px] px-2 py-1 rounded
                    ${b.rolled ? 'text-white/20 line-through' : 'text-white/60'}`}>
                    <span>{b.wallet.slice(0,6)}…{b.wallet.slice(-4)}</span>
                    <span className={b.tier === 2 ? 'tag-tier2' : 'tag-tier1'}>×{b.tier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prize Pool */}
          <div className="panel">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 tracking-widest">PRIZE POOL</p>
              <button
                onClick={() => setAddPrize(!addPrize)}
                className="text-[10px] text-gold/70 border border-gold/30 px-2 py-0.5 hover:border-gold/60 transition"
              >
                + ADD
              </button>
            </div>

            {/* Add prize form */}
            {addPrize && (
              <div className="flex flex-col gap-2 mb-4 p-3 border border-white/10 rounded text-[11px]">
                <input placeholder="Prize name"
                  className="bg-transparent border border-white/20 px-2 py-1 text-white"
                  value={newPrize.name || ''}
                  onChange={e => setNewPrize(p => ({ ...p, name: e.target.value }))} />
                <label className="border border-white/20 px-2 py-1 cursor-pointer text-center text-white/50 hover:border-white/40 transition">
                  {imageFile ? imageFile.name : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select className="bg-ash-mid border border-white/20 px-2 py-1 text-white"
                    value={newPrize.tier}
                    onChange={e => setNewPrize(p => ({ ...p, tier: parseInt(e.target.value) as 1|2 }))}>
                    <option value={1}>Tier 1</option>
                    <option value={2}>Tier 2</option>
                  </select>
                  <select className="bg-ash-mid border border-white/20 px-2 py-1 text-white"
                    value={newPrize.chain}
                    onChange={e => setNewPrize(p => ({ ...p, chain: e.target.value as Prize['chain'] }))}>
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                    <option value="abstract">Abstract</option>
                  </select>
                </div>
                <input placeholder="Contract address (0x...)"
                  className="bg-transparent border border-white/20 px-2 py-1 text-white"
                  value={newPrize.contract || ''}
                  onChange={e => setNewPrize(p => ({ ...p, contract: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Token ID"
                    className="bg-transparent border border-white/20 px-2 py-1 text-white"
                    value={newPrize.tokenId || ''}
                    onChange={e => setNewPrize(p => ({ ...p, tokenId: e.target.value }))} />
                  <select className="bg-ash-mid border border-white/20 px-2 py-1 text-white"
                    value={newPrize.standard}
                    onChange={e => setNewPrize(p => ({ ...p, standard: e.target.value as Prize['standard'] }))}>
                    <option>ERC-721</option>
                    <option>ERC-1155</option>
                  </select>
                </div>
                <button onClick={addPrizeSubmit}
                  className="bg-gold/10 border border-gold/40 text-gold py-1 tracking-widest hover:bg-gold/20 transition">
                  ADD PRIZE
                </button>
              </div>
            )}

            {/* Prize list */}
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {state.prizes.map(p => (
                <div key={p.id} className={`flex items-center gap-2 p-2 rounded border
                  ${p.assigned ? 'border-white/5 opacity-40' : 'border-white/10'}`}>
                  <img src={p.imageUrl} alt={p.name}
                    className="w-8 h-8 object-cover rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-white truncate">{p.name}</p>
                    <p className="text-[9px] text-white/30">{p.chain} · {p.standard}</p>
                  </div>
                  <span className={p.tier === 2 ? 'tag-tier2' : 'tag-tier1'}>×{p.tier}</span>
                  {!p.assigned && (
                    <button onClick={() => removePrize(p.id)}
                      className="text-white/20 hover:text-red-400 text-xs">✕</button>
                  )}
                </div>
              ))}
              {state.prizes.length === 0 && (
                <p className="text-white/20 text-xs text-center py-4">no prizes yet</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Center: Roulette ── */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Wheel */}
          <div className="panel">
            <div className="relative overflow-hidden h-[220px] select-none" style={{ width: '100%' }}>
              {/* Fade edges */}
              <div className="absolute inset-y-0 left-0 w-24 roulette-fade-left z-10 pointer-events-none" />
              <div className="absolute inset-y-0 right-0 w-24 roulette-fade-right z-10 pointer-events-none" />
              {/* Center marker */}
              <div className="roulette-marker" />

              {/* Track */}
              <div className="absolute inset-0 flex items-center px-4">
                <div ref={trackRef} className="flex gap-1" style={{ transform: 'translateX(0)' }}>
                  {strip.length > 0 ? strip.map((prize, i) => (
                    <div key={i} className={`roulette-card ${i === winnerIdx ? 'winner' : ''}`}
                         style={{ background: '#1a1a1a' }}>
                      <img src={prize.imageUrl} alt={prize.name}
                           className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 py-1 px-2">
                        <p className="text-[10px] text-white text-center truncate">{prize.name}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center text-white/20 text-xs tracking-widest"
                         style={{ width: 800 }}>
                      ADD PRIZES & BURNERS, THEN ROLL
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Winner reveal */}
            {lastResult && !spinning && (
              <div className="mt-4 p-4 border border-gold/40 bg-gold/5 text-center fade-in">
                <p className="text-xs text-white/40 tracking-widest mb-1">WINNER</p>
                <p className="text-gold font-bold text-lg tracking-wider">
                  {lastResult.wallet.slice(0,6)}…{lastResult.wallet.slice(-4)}
                </p>
                <p className="text-white/70 text-sm mt-1">🎁 {lastResult.prize.name}</p>
                <p className="text-[10px] text-white/30 mt-1">
                  {lastResult.prize.chain} · {lastResult.prize.contract.slice(0,8)}… · #{lastResult.prize.tokenId}
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-4 items-center justify-center">
            <div className="flex border border-white/20 text-xs">
              {([1,2] as const).map(t => (
                <button key={t} onClick={() => setRollTier(t)}
                  className={`px-5 py-2 tracking-widest transition
                    ${rollTier === t ? 'bg-gold/20 text-gold' : 'text-white/40 hover:text-white/60'}`}>
                  TIER {t}
                </button>
              ))}
            </div>
            <button
              onClick={roll}
              disabled={spinning || state.prizes.length < 5}
              className="px-10 py-3 bg-gold text-black font-bold tracking-widest text-sm
                         hover:bg-gold-dim transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
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
                      {r.sent ? '✓ SENT' : 'PENDING'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Danger zone */}
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
