'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic               from 'next/dynamic';
import { useConnectModal }   from '@rainbow-me/rainbowkit';
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, useDisconnect,
} from 'wagmi';
import { base }              from 'wagmi/chains';
import { getStatus, recordBurn, getWalletBurns, type BurnStatus } from '@/lib/api';
import type { BurnRoomBurnRequest }                               from '@/src/burn-room';

// ── 3D room — client-only, Three.js needs browser ────────────────────────
const VacuumBurnRoomExperience = dynamic(
  () => import('@/src/burn-room').then(m => m.VacuumBurnRoomExperience),
  { ssr: false, loading: () => <RoomLoader /> },
);


// ── WebGL detection ───────────────────────────────────────────────────────
function checkWebGL(): 'ok' | 'unavailable' {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// ── Contract config ───────────────────────────────────────────────────────
const TOKEN    = '0x04619852f38ebec22bb94ef36b99351db9900194' as const;
const TOKEN_ID = BigInt(3);
const DEAD     = '0x000000000000000000000000000000000000dEaD' as const;

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
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id',      type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

type Phase = 'idle' | 'pending' | 'confirming' | 'recording' | 'done' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────

// Type-safe filter for soldOutItemIds
type SoldOutId = 'archive-tag' | 'gilded-seal';

function buildSoldOutIds(
  status:      BurnStatus | null,
  walletBurns: { burnedTier1: boolean; burnedTier2: boolean } | null,
): readonly SoldOutId[] {
  const ids: SoldOutId[] = [];
  if (!status?.burn1Open)                            ids.push('archive-tag');
  if (!status?.burn2Open || walletBurns?.burnedTier2) ids.push('gilded-seal');
  return ids;
}

// ── Component ─────────────────────────────────────────────────────────────
export function BurnExperience() {
  const { address, chainId } = useAccount();
  const { switchChain }      = useSwitchChain();
  const { disconnect }       = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const [status,      setStatus]      = useState<BurnStatus | null>(null);
  const [walletBurns, setWalletBurns] = useState<{ burnedTier1: boolean; burnedTier2: boolean } | null>(null);
  const [phase,       setPhase]       = useState<Phase>('idle');
  const [txHash,      setTxHash]      = useState<`0x${string}` | undefined>();
  const [activeTier,  setActiveTier]  = useState<1 | 2 | null>(null);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [webgl,       setWebgl]       = useState<'ok' | 'unavailable' | 'checking'>('checking');

  // Token balance
  const { data: balance } = useReadContract({
    address: TOKEN, abi: ERC1155_ABI,
    functionName: 'balanceOf',
    args: address ? [address, TOKEN_ID] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  useEffect(() => { setWebgl(checkWebGL()); }, []);

  const fetchStatus = useCallback(async () => {
    try { setStatus(await getStatus()); } catch {}
  }, []);

  const fetchWalletBurns = useCallback(async (addr: string) => {
    try { setWalletBurns(await getWalletBurns(addr)); } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    if (address) fetchWalletBurns(address);
    else setWalletBurns(null);
  }, [address, fetchWalletBurns]);

  // Write contract
  const { writeContract } = useWriteContract({
    mutation: {
      onSuccess: (hash) => { setTxHash(hash); setPhase('confirming'); },
      onError:   (err)  => { setPhase('error'); setErrorMsg(err.message.slice(0, 140)); },
    },
  });

  // Wait for on-chain confirmation
  const { isSuccess: txConfirmed, isError: txFailed } = useWaitForTransactionReceipt({
    hash:  txHash,
    query: { enabled: !!txHash && phase === 'confirming' },
  });

  useEffect(() => {
    if (!txConfirmed || !txHash || !activeTier || !address) return;
    setPhase('recording');

    recordBurn(txHash, activeTier)
      .then(() => {
        setPhase('done');
        fetchStatus();
        fetchWalletBurns(address);
      })
      .catch((err: Error) => {
        setPhase('error');
        setErrorMsg(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed]);

  useEffect(() => {
    if (txFailed) { setPhase('error'); setErrorMsg('Transaction failed on-chain.'); }
  }, [txFailed]);

  // Called by the 3D room after the ritual completes
  const handleBurnRequested = useCallback((request: BurnRoomBurnRequest) => {
    if (!address) return;

    // Prompt chain switch if not on Base already
    if (chainId !== base.id) {
      switchChain({ chainId: base.id });
      return;
    }

    const tier = request.tier as 1 | 2;
    setActiveTier(tier);
    setPhase('pending');
    setTxHash(undefined);
    setErrorMsg('');

    writeContract({
      address: TOKEN, abi: ERC1155_ABI,
      functionName: 'safeTransferFrom',
      args: [address, DEAD, TOKEN_ID, BigInt(tier), '0x'],
      chainId: base.id,
    });
  }, [address, chainId, switchChain, writeContract]);

  const reset = useCallback(() => {
    setPhase('idle');
    setTxHash(undefined);
    setActiveTier(null);
    setErrorMsg('');
  }, []);

  if (webgl === 'unavailable') return <WebGLError />;

  const soldOutItemIds = buildSoldOutIds(status, walletBurns);
  const isProcessing   = phase === 'pending' || phase === 'confirming' || phase === 'recording';

  return (
    <>
      {/* 3D room — fills viewport via its own position:fixed */}
      <VacuumBurnRoomExperience
        walletConnected={!!address}
        walletLabel={address ? `${address.slice(0, 6)}\u2026${address.slice(-4)}` : undefined}
        availableBoxCount={balance !== undefined ? Number(balance) : 0}
        soldOutItemIds={soldOutItemIds}
        showDevSoldOutSwitch={false}
        onConnectWallet={openConnectModal ?? (() => {})}
        onBurnRequested={handleBurnRequested}
        burn2Remaining={status ? 7 - status.burn2Count : 7}
        burn1Open={status?.burn1Open ?? true}
        onExit={handleExit}
      />

      {/* TX status overlay — fixed so it sits above the fixed canvas */}
      {(isProcessing || phase === 'done' || phase === 'error') && (
        <div className="fixed inset-0 flex items-end justify-center pb-12 pointer-events-none z-50">
          <div className="pointer-events-auto mx-4 max-w-sm w-full">

            {isProcessing && (
              <div className="bg-black/85 border border-white/10 backdrop-blur-sm p-5 text-center">
                <div className="w-7 h-7 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs tracking-widest text-white/70 font-mono uppercase">
                  {phase === 'pending'    && 'Waiting for wallet\u2026'}
                  {phase === 'confirming' && 'Confirming on Base\u2026'}
                  {phase === 'recording'  && 'Recording burn\u2026'}
                </p>
                {txHash && (
                  <a href={`https://basescan.org/tx/${txHash}`}
                     target="_blank" rel="noreferrer"
                     className="block mt-2 text-[10px] text-orange-400/60 underline tracking-wider">
                    view on basescan ↗
                  </a>
                )}
              </div>
            )}

            {phase === 'done' && (
              <div className="bg-black/85 border border-orange-500/40 backdrop-blur-sm p-5 text-center">
                <p className="text-orange-400 font-mono text-sm tracking-widest mb-1">🔥 BURNED</p>
                <p className="text-white/50 text-[11px] tracking-widest mb-3">
                  Tier {activeTier} burn recorded. You&apos;re in.
                </p>
                {txHash && (
                  <a href={`https://basescan.org/tx/${txHash}`}
                     target="_blank" rel="noreferrer"
                     className="block text-[10px] text-orange-400/60 underline mb-3">
                    view tx ↗
                  </a>
                )}
                <button onClick={reset}
                  className="text-[11px] text-white/30 underline hover:text-white/60 font-mono tracking-widest">
                  dismiss
                </button>
              </div>
            )}

            {phase === 'error' && (
              <div className="bg-black/85 border border-red-900/50 backdrop-blur-sm p-5 text-center">
                <p className="text-red-400 font-mono text-sm tracking-widest mb-2">ERROR</p>
                {errorMsg && (
                  <p className="text-white/40 text-[11px] mb-3 max-w-xs mx-auto break-words">
                    {errorMsg}
                  </p>
                )}
                <button onClick={reset}
                  className="text-[11px] text-white/40 underline hover:text-white/60 font-mono tracking-widest">
                  try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Wallet overlay — top right, DOM-based for full wallet management */}
      <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2">
        {!address ? (
          <button
            onClick={openConnectModal ?? (() => {})}
            className="bg-[#17121f] border-2 border-[#d6b55b] text-[#d6b55b] text-xs
                       font-mono tracking-widest px-4 py-2 hover:bg-[#d6b55b] hover:text-[#17121f]
                       transition-all shadow-[2px_2px_0_#17121f]"
          >
            CONNECT WALLET
          </button>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <div className="bg-[#17121f]/80 border border-[#d6b55b]/40 backdrop-blur-sm
                           text-[#d6b55b] text-[10px] font-mono tracking-wider px-3 py-1.5">
              {address.slice(0,6)}…{address.slice(-4)}
              {chainId !== base.id && (
                <span className="ml-2 text-red-400">wrong network</span>
              )}
            </div>
            <div className="flex gap-1">
              {chainId !== base.id && (
                <button
                  onClick={() => switchChain({ chainId: base.id })}
                  className="bg-[#17121f]/80 border border-orange-400/60 text-orange-400
                             text-[9px] font-mono tracking-widest px-2 py-1
                             hover:bg-orange-400 hover:text-[#17121f] transition-all"
                >
                  SWITCH TO BASE
                </button>
              )}
              <button
                onClick={() => disconnect()}
                className="bg-[#17121f]/80 border border-white/20 text-white/40
                           text-[9px] font-mono tracking-widest px-2 py-1
                           hover:border-red-400/60 hover:text-red-400 transition-all"
              >
                DISCONNECT
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Discreet admin link */}
      <a href="/admin"
         className="fixed bottom-4 right-4 z-40 text-[9px] text-white/15 hover:text-white/40
                    tracking-widest font-mono transition-colors">
        ADMIN
      </a>
    </>
  );
}

function RoomLoader() {
  return (
    <div className="fixed inset-0 bg-[#aec9bf] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#17121f]/30 border-t-[#17121f] rounded-full animate-spin" />
    </div>
  );
}

function WebGLError() {
  return (
    <div className="fixed inset-0 bg-[#aec9bf] flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-[#d4dde0] border-4 border-[#17121f] p-6 shadow-[4px_4px_0_#17121f] text-center">
        <p className="font-bold text-[#17121f] text-lg mb-2">WebGL Unavailable</p>
        <p className="text-[#17121f]/70 text-sm mb-4">
          Your browser can&apos;t render the burn room. This is usually a graphics driver issue.
        </p>
        <div className="text-left text-xs text-[#17121f]/60 space-y-2 mb-4 bg-[#17121f]/5 p-3">
          <p className="font-semibold text-[#17121f]/80">Fix for Chrome on Windows:</p>
          <p>1. Go to <code className="bg-[#17121f]/10 px-1">chrome://flags/#use-angle</code></p>
          <p>2. Change <strong>D3D9</strong> → <strong>D3D11</strong></p>
          <p>3. Relaunch Chrome</p>
        </div>
        <p className="text-[#17121f]/50 text-xs">Or try Firefox / Edge as an alternative.</p>
      </div>
    </div>
  );
}
