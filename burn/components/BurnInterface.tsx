'use client';

import { useState, useEffect } from 'react';
import { ConnectButton }       from '@rainbow-me/rainbowkit';
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi';
import { base }        from 'wagmi/chains';
import { getStatus, recordBurn, getWalletBurns, type BurnStatus, type WalletBurns } from '@/lib/api';

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
    inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

type Phase = 'idle' | 'pending' | 'confirming' | 'recording' | 'done' | 'error';

export function BurnInterface() {
  const { address, chainId } = useAccount();
  const { switchChain }      = useSwitchChain();

  const [status,      setStatus]      = useState<BurnStatus | null>(null);
  const [walletBurns, setWalletBurns] = useState<WalletBurns | null>(null);
  const [phase,       setPhase]       = useState<Phase>('idle');
  const [txHash,      setTxHash]      = useState<`0x${string}` | undefined>();
  const [activeTier,  setActiveTier]  = useState<1 | 2 | null>(null);
  const [message,     setMessage]     = useState('');
  const [lastWallet,  setLastWallet]  = useState('');

  const { data: balance } = useReadContract({
    address: TOKEN, abi: ERC1155_ABI,
    functionName: 'balanceOf',
    args: address ? [address, TOKEN_ID] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
  const bal = balance ? Number(balance) : 0;

  const fetchStatus = async () => {
    try { setStatus(await getStatus()); } catch {}
  };

  const fetchWalletBurns = async (addr: string) => {
    try { setWalletBurns(await getWalletBurns(addr)); } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, []);

  // Fetch wallet-specific burn history whenever address changes
  useEffect(() => {
    if (address) fetchWalletBurns(address);
    else setWalletBurns(null);
  }, [address]);

  const { writeContract, isPending: isWalletPending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => { setTxHash(hash); setPhase('confirming'); },
      onError:   (err)  => { setPhase('error'); setMessage(err.message.slice(0, 120)); },
    },
  });

  const { isSuccess: txConfirmed, isError: txFailed } = useWaitForTransactionReceipt({
    hash:  txHash,
    query: { enabled: !!txHash && phase === 'confirming' },
  });

  useEffect(() => {
    if (!txConfirmed || !txHash || !activeTier) return;
    setPhase('recording');

    recordBurn(txHash, activeTier)
      .then((res) => {
        setPhase('done');
        setLastWallet(res.wallet);
        setMessage('');
        fetchStatus();
        // Refresh wallet burn state so button hides immediately
        if (address) fetchWalletBurns(address);
      })
      .catch((err) => {
        setPhase('error');
        setMessage(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed]);

  useEffect(() => {
    if (txFailed) { setPhase('error'); setMessage('Transaction failed on-chain.'); }
  }, [txFailed]);

  const doBurn = (tier: 1 | 2) => {
    if (!address) return;
    if (chainId !== base.id) { switchChain({ chainId: base.id }); return; }
    setActiveTier(tier);
    setPhase('pending');
    setTxHash(undefined);
    setMessage('');

    writeContract({
      address: TOKEN, abi: ERC1155_ABI,
      functionName: 'safeTransferFrom',
      args: [address, DEAD, TOKEN_ID, BigInt(tier), '0x'],
      chainId: base.id,
    });
  };

  const reset = () => { setPhase('idle'); setTxHash(undefined); setActiveTier(null); setMessage(''); };

  const wrongChain   = !!address && chainId !== base.id;
  const burn2Slots   = status ? 7 - status.burn2Count : 7;
  const burn2Avail   = !!status?.burn2Open;
  const burn1Avail   = !!status?.burn1Open;

  // Per-wallet: hide burn ×2 if this wallet already burned ×2
  const walletUsedBurn2 = walletBurns?.burnedTier2 === true;
  const showBurn2       = !walletUsedBurn2 && burn2Avail;

  const isProcessing = ['pending','confirming','recording'].includes(phase);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-lg mx-auto">

      <ConnectButton showBalance={false} chainStatus="none" />

      {wrongChain && (
        <p className="text-burn text-sm tracking-wider">
          ⚠ Switch to <strong>Base</strong> to burn
        </p>
      )}

      {status && (
        <div className="w-full grid grid-cols-3 gap-3 text-center text-xs tracking-widest text-white/50">
          <div className="stat-box">
            <div className="text-2xl font-bold text-white">{status.totalBurn1}</div>
            <div>BURN ×1</div>
          </div>
          <div className="stat-box">
            <div className="text-2xl font-bold text-burn">{status.totalBurn2}</div>
            <div>BURN ×2</div>
          </div>
          <div className={`stat-box ${burn2Avail ? 'border-burn/40' : 'opacity-40'}`}>
            <div className="text-2xl font-bold text-ember">{burn2Slots}</div>
            <div>SLOTS LEFT</div>
          </div>
        </div>
      )}

      {address && (
        <p className="text-white/40 text-xs tracking-widest">
          YOUR BALANCE: <span className="text-white">{bal}</span> TOKEN{bal !== 1 ? 'S' : ''}
          {walletUsedBurn2 && (
            <span className="ml-3 text-white/25">(×2 already burned)</span>
          )}
        </p>
      )}

      {phase === 'idle' && (
        <div className="flex flex-col gap-4 w-full">

          {/* Burn 2 — hidden if wallet already used it */}
          {showBurn2 && (
            <div className="flex flex-col gap-2">
              <button
                className="btn-burn-2 w-full"
                disabled={!address || wrongChain || bal < 2 || isProcessing}
                onClick={() => doBurn(2)}
              >
                🔥 BURN ×2
              </button>
              <p className="text-center text-xs text-white/30 tracking-widest">
                {burn2Slots} OF 5 SLOTS REMAINING
              </p>
            </div>
          )}

          {/* Burn 2 closed globally */}
          {!burn2Avail && !walletUsedBurn2 && (
            <div className="flex flex-col gap-2">
              <button className="btn-burn-2 w-full" disabled>🔥 BURN ×2</button>
              <p className="text-center text-xs text-white/30 tracking-widest">CLOSED — ALL 5 SLOTS FILLED</p>
            </div>
          )}

          {/* Burn 2 — wallet already used theirs */}
          {walletUsedBurn2 && (
            <div className="py-4 border border-white/5 text-center text-xs text-white/20 tracking-widest">
              ✓ YOU HAVE ALREADY BURNED ×2
            </div>
          )}

          {/* Burn 1 */}
          <div className="flex flex-col gap-2">
            <button
              className="btn-burn w-full"
              disabled={!address || wrongChain || !burn1Avail || bal < 1 || isProcessing}
              onClick={() => doBurn(1)}
            >
              🔥 BURN ×1
            </button>
            {!burn1Avail && (
              <p className="text-center text-xs text-white/30 tracking-widest">CLOSED</p>
            )}
          </div>

          {address && bal === 0 && (
            <p className="text-center text-xs text-white/30">no tokens in this wallet</p>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="flex flex-col items-center gap-4 w-full">
          <div className="w-10 h-10 border-2 border-burn border-t-transparent rounded-full animate-spin" />
          <p className="text-sm tracking-widest text-white/70">
            {phase === 'pending'    && 'WAITING FOR WALLET…'}
            {phase === 'confirming' && 'CONFIRMING ON BASE…'}
            {phase === 'recording'  && 'RECORDING BURN…'}
          </p>
          {txHash && (
            <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer"
               className="text-xs text-burn/70 underline tracking-wider">
              view on basescan ↗
            </a>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center gap-4 text-center w-full border border-burn/40 p-6 rounded">
          <div className="text-4xl">🔥</div>
          <p className="text-xl font-bold tracking-widest text-burn">BURNED</p>
          <p className="text-xs text-white/50 tracking-widest">
            {lastWallet.slice(0,6)}…{lastWallet.slice(-4)} has been entered.
          </p>
          {txHash && (
            <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer"
               className="text-xs text-burn/70 underline">view tx ↗</a>
          )}
          <button onClick={reset} className="text-xs text-white/30 underline mt-2">
            burn again
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-3 text-center w-full border border-red-900/50 p-5 rounded">
          <p className="text-red-400 text-sm tracking-wider">ERROR</p>
          {message && <p className="text-xs text-white/40 max-w-xs">{message}</p>}
          <button onClick={reset} className="text-xs text-white/40 underline mt-1">try again</button>
        </div>
      )}
    </div>
  );
}
