'use client';

import { useState, useEffect } from 'react';
import { ConnectButton }       from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { mainnet, base }       from 'wagmi/chains';
import { abstract }            from '@/lib/wagmi';
import type { Result }         from '@/lib/types';

const STORAGE_KEY = 'reveal_state_v1';
const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
  .split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

// ─── ABIs ──────────────────────────────────────────────────────────────────
const ERC721_ABI = [
  {
    name: 'safeTransferFrom', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from',    type: 'address' },
      { name: 'to',      type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const ERC1155_ABI = [
  {
    name: 'safeTransferFrom', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from',   type: 'address' },
      { name: 'to',     type: 'address' },
      { name: 'id',     type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data',   type: 'bytes'   },
    ],
    outputs: [],
  },
] as const;

const CHAIN_IDS: Record<string, number> = {
  ethereum: mainnet.id,
  base:     base.id,
  abstract: abstract.id,
};

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  base:     'Base',
  abstract: 'Abstract',
};

const CHAIN_COLORS: Record<string, string> = {
  ethereum: 'text-blue-300  border-blue-300/30',
  base:     'text-blue-400  border-blue-400/30',
  abstract: 'text-green-300 border-green-300/30',
};

// ─── Main ──────────────────────────────────────────────────────────────────
export default function DistributePage() {
  const { address, chainId } = useAccount();
  const { switchChain }      = useSwitchChain();
  const isAdmin = !!address && ADMIN_WALLETS.includes(address.toLowerCase());

  const [results,     setResults]     = useState<Result[]>([]);
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [msg,         setMsg]         = useState('');
  const [filterChain, setFilterChain] = useState<string>('all');

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setResults(JSON.parse(raw).results || []);
    } catch {}
  }, []);

  // Also allow CSV import
  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = (ev.target?.result as string).trim().split('\n').slice(1);
      const imported: Result[] = lines.map(line => {
        const [wallet, tier, prize_name, contract, token_id, chain, standard, rolled_at] =
          line.split(',').map(s => s.replace(/"/g, '').trim());
        return {
          id:       crypto.randomUUID(),
          wallet:   wallet.toLowerCase(),
          tier:     parseInt(tier) as 1|2,
          prize: {
            id: crypto.randomUUID(), name: prize_name,
            imageUrl: '', tier: parseInt(tier) as 1|2,
            chain: chain as Result['prize']['chain'],
            contract, tokenId: token_id,
            standard: standard as Result['prize']['standard'],
            assigned: true, distributed: false,
          },
          rolledAt: rolled_at,
          sent:     false,
        };
      });
      setResults(imported);
    };
    reader.readAsText(file);
  };

  // Write contract
  const { writeContract, isPending } = useWriteContract({
    mutation: {
      onSuccess: hash => { setPendingHash(hash); setMsg(''); },
      onError:   err  => { setMsg(err.message.slice(0,120)); setActiveId(null); },
    },
  });

  // Wait for confirmation
  const { isSuccess, isError } = useWaitForTransactionReceipt({
    hash:  pendingHash,
    query: { enabled: !!pendingHash && !!activeId },
  });

  useEffect(() => {
    if (!isSuccess || !activeId || !pendingHash) return;
    setResults(prev => prev.map(r =>
      r.id === activeId ? { ...r, sent: true, txHash: pendingHash } : r
    ));
    // Also persist
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        s.results = s.results.map((r: Result) =>
          r.id === activeId ? { ...r, sent: true, txHash: pendingHash } : r
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      }
    } catch {}
    setActiveId(null);
    setPendingHash(undefined);
    setMsg('✓ Sent!');
  }, [isSuccess, activeId, pendingHash]);

  useEffect(() => {
    if (isError) { setMsg('Transaction failed.'); setActiveId(null); }
  }, [isError]);

  const sendNFT = (result: Result) => {
    if (!address) return;
    const targetChainId = CHAIN_IDS[result.prize.chain];
    if (chainId !== targetChainId) {
      switchChain({ chainId: targetChainId });
      return;
    }
    setActiveId(result.id);
    setPendingHash(undefined);
    setMsg('');

    if (result.prize.standard === 'ERC-721') {
      writeContract({
        address:      result.prize.contract as `0x${string}`,
        abi:          ERC721_ABI,
        functionName: 'safeTransferFrom',
        args:         [address, result.wallet as `0x${string}`, BigInt(result.prize.tokenId)],
        chainId:      targetChainId,
      });
    } else {
      writeContract({
        address:      result.prize.contract as `0x${string}`,
        abi:          ERC1155_ABI,
        functionName: 'safeTransferFrom',
        args:         [address, result.wallet as `0x${string}`, BigInt(result.prize.tokenId), 1n, '0x'],
        chainId:      targetChainId,
      });
    }
  };

  const pending = results.filter(r => !r.sent);
  const done    = results.filter(r => r.sent);
  const chains  = [...new Set(results.map(r => r.prize.chain))];
  const filtered = filterChain === 'all'
    ? results
    : results.filter(r => r.prize.chain === filterChain);

  if (!address || !isAdmin) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6">
        <h1 className="text-2xl font-bold tracking-[0.2em] text-gold">DISTRIBUTE</h1>
        <ConnectButton />
        {address && <p className="text-red-400/60 text-xs">Not an admin wallet.</p>}
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-[0.2em] text-gold">DISTRIBUTE</h1>
          <p className="text-xs text-white/30 mt-1">
            {pending.length} pending · {done.length} sent
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectButton showBalance={false} chainStatus="full" />
          <a href="/roulette" className="text-xs text-white/30 underline hover:text-white/50">← roulette</a>
        </div>
      </div>

      {/* Import CSV */}
      {results.length === 0 && (
        <div className="panel text-center py-8">
          <p className="text-white/40 text-xs mb-4">No results loaded. Import a results CSV or open roulette first.</p>
          <label className="cursor-pointer border border-white/20 hover:border-white/40 text-xs
                            text-white/60 py-2 px-6 tracking-widest transition inline-block">
            IMPORT results.csv
            <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
          </label>
        </div>
      )}

      {/* Chain filter */}
      {results.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterChain('all')}
            className={`text-[11px] px-3 py-1 border tracking-widest transition
              ${filterChain === 'all' ? 'border-gold/60 text-gold' : 'border-white/20 text-white/40'}`}>
            ALL ({results.length})
          </button>
          {chains.map(c => (
            <button key={c} onClick={() => setFilterChain(c)}
              className={`text-[11px] px-3 py-1 border tracking-widest transition
                ${filterChain === c ? `${CHAIN_COLORS[c]} bg-white/5` : 'border-white/20 text-white/40'}`}>
              {CHAIN_LABELS[c]} ({results.filter(r => r.prize.chain === c).length})
            </button>
          ))}
        </div>
      )}

      {/* Distribution list */}
      <div className="flex flex-col gap-3">
        {filtered.map(result => {
          const isActive   = activeId === result.id;
          const needSwitch = chainId !== CHAIN_IDS[result.prize.chain];

          return (
            <div key={result.id}
              className={`flex items-center gap-4 p-4 border rounded transition
                ${result.sent ? 'border-green-900/30 opacity-50' : 'border-white/10 hover:border-white/20'}`}>

              {/* Prize image */}
              {result.prize.imageUrl ? (
                <img src={result.prize.imageUrl} alt={result.prize.name}
                  className="w-12 h-12 object-cover rounded flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 bg-white/5 rounded flex-shrink-0 flex items-center
                                justify-center text-white/20 text-xs">NFT</div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{result.prize.name}</p>
                <p className="text-[11px] text-white/50">
                  → {result.wallet.slice(0,6)}…{result.wallet.slice(-4)}
                </p>
                <p className="text-[10px] text-white/25 mt-0.5">
                  {result.prize.contract.slice(0,10)}… · #{result.prize.tokenId} · {result.prize.standard}
                </p>
              </div>

              {/* Chain badge */}
              <span className={`text-[10px] border px-2 py-0.5 ${CHAIN_COLORS[result.prize.chain]}`}>
                {CHAIN_LABELS[result.prize.chain]}
              </span>

              {/* Tier */}
              <span className={result.tier === 2 ? 'tag-tier2' : 'tag-tier1'}>×{result.tier}</span>

              {/* Action */}
              {result.sent ? (
                <div className="text-right text-[10px]">
                  <span className="text-green-400">✓ SENT</span>
                  {result.txHash && (
                    <a href={`https://${result.prize.chain === 'ethereum'
                      ? 'etherscan.io' : result.prize.chain === 'base'
                      ? 'basescan.org' : 'explorer.mainnet.abs.xyz'}/tx/${result.txHash}`}
                      target="_blank" rel="noreferrer"
                      className="block text-white/30 underline hover:text-white/50 mt-0.5">
                      tx ↗
                    </a>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => sendNFT(result)}
                  disabled={!!activeId || isPending}
                  className="px-4 py-2 text-xs border border-gold/40 text-gold tracking-widest
                             hover:bg-gold/10 transition disabled:opacity-40 disabled:cursor-not-allowed
                             flex-shrink-0"
                >
                  {isActive
                    ? (isPending ? 'SIGN…' : 'CONFIRMING…')
                    : needSwitch ? 'SWITCH CHAIN' : 'SEND'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {msg && <p className="text-center text-xs text-white/50">{msg}</p>}

      {results.length > 0 && pending.length === 0 && (
        <div className="text-center py-8 text-green-400 text-sm tracking-widest">
          ✓ ALL DISTRIBUTIONS COMPLETE
        </div>
      )}
    </main>
  );
}
