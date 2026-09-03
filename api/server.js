const express   = require('express');
const cors      = require('cors');
const { createPublicClient, createWalletClient, http, parseAbiItem } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base, mainnet } = require('viem/chains');
const {
  db, getBurnStatus, recordBurn, setBurn1Open, setEventLive,
  startBurn1Timer, stopBurn1Timer, hasWalletBurned1, getAllBurns, hasTx,
  hasPoolTx, hasWalletPool, getPoolBurns, recordPoolBurn,
  setPoolOpen, setPoolBatchSent, getPoolLastBlock, setPoolLastBlock,
  replaceSlideshowItems, getSlideshowItems,
} = require('./db');

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [process.env.BURN_SITE_URL, process.env.REVEAL_SITE_URL].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.endsWith('.vercel.app')) return cb(null, true);
    cb(new Error('CORS'));
  },
}));

// ─── Constants ────────────────────────────────────────────────────────────────
const TOKEN_CONTRACT = '0x04619852f38ebec22bb94ef36b99351db9900194';
const TOKEN_ID       = BigInt(3);
const DEAD_ADDRESS   = '0x000000000000000000000000000000000000dead';
const MAX_BURN2      = 5;
const POOL_MAX       = 15;
const ADMIN_KEY      = process.env.ADMIN_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

// ─── Manifold ─────────────────────────────────────────────────────────────────
const MANIFOLD_T2_CONTRACT = process.env.MANIFOLD_CONTRACT_ADDRESS || null;
const MANIFOLD_T2_TOKEN_ID = BigInt(process.env.MANIFOLD_TOKEN_ID || '1');

// ┌────────────────────────────────────────────────────────────────────────────┐
// │ SET THESE IN RAILWAY:                                                       │
// │ MANIFOLD_TIER1_CONTRACT_ADDRESS = <contract>                               │
// │ MANIFOLD_TIER1_TOKEN_ID         = <token id>  ← ASK YOUR FRIEND           │
// └────────────────────────────────────────────────────────────────────────────┘
const MANIFOLD_T1_CONTRACT = process.env.MANIFOLD_TIER1_CONTRACT_ADDRESS || null;
const MANIFOLD_T1_TOKEN_ID = BigInt(process.env.MANIFOLD_TIER1_TOKEN_ID || '0');

// Pool uses same contract/token as tier 1 by default — override with MANIFOLD_POOL_TOKEN_ID if needed
const MANIFOLD_POOL_CONTRACT = process.env.MANIFOLD_POOL_CONTRACT_ADDRESS || MANIFOLD_T1_CONTRACT;
const MANIFOLD_POOL_TOKEN_ID = BigInt(process.env.MANIFOLD_POOL_TOKEN_ID || process.env.MANIFOLD_TIER1_TOKEN_ID || '0');

const MANIFOLD_CHAIN = process.env.MANIFOLD_CONTRACT_CHAIN === 'mainnet' ? mainnet : base;
const MINTER_KEY     = process.env.MINTER_PRIVATE_KEY || null;

const MANIFOLD_ABI = [{
  name: 'mintBaseExisting', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'to',       type: 'address[]' },
    { name: 'tokenIds', type: 'uint256[]' },
    { name: 'amounts',  type: 'uint256[]' },
  ],
  outputs: [],
}];

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
];

let _minterClient = null;
function getMinterClient() {
  if (_minterClient) return _minterClient;
  if (!MINTER_KEY) return null;
  const account = privateKeyToAccount(MINTER_KEY.startsWith('0x') ? MINTER_KEY : '0x' + MINTER_KEY);
  _minterClient = createWalletClient({ account, chain: MANIFOLD_CHAIN, transport: http(process.env.MANIFOLD_RPC_URL || undefined) });
  return _minterClient;
}

function getMinterAddress() {
  return getMinterClient()?.account?.address?.toLowerCase() || null;
}

const mintManifoldNFT = async (toAddress, tier) => {
  const walletClient = getMinterClient();
  if (!walletClient) { console.log('[manifold] skipped — no minter key'); return; }

  let contract, tokenId;
  if (tier === 'pool') { contract = MANIFOLD_POOL_CONTRACT; tokenId = MANIFOLD_POOL_TOKEN_ID; }
  else if (tier === 1) { contract = MANIFOLD_T1_CONTRACT;   tokenId = MANIFOLD_T1_TOKEN_ID; }
  else                 { contract = MANIFOLD_T2_CONTRACT;   tokenId = MANIFOLD_T2_TOKEN_ID; }

  if (!contract) { console.log(`[manifold] skipped tier ${tier} — contract not configured`); return; }
  if (tokenId === 0n) { console.warn(`[manifold] ⚠️  token ID not set for tier ${tier}`); return; }

  const hash = await walletClient.writeContract({
    address: contract, abi: MANIFOLD_ABI, functionName: 'mintBaseExisting',
    args: [[toAddress], [tokenId], [1n]],
  });
  console.log(`[manifold] tier:${tier} minted #${tokenId} to ${toAddress} — tx ${hash}`);
};

// ─── Public client ────────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

const TRANSFER_SINGLE = parseAbiItem(
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
);

// ─── Pool scanner ─────────────────────────────────────────────────────────────
// Polls every 30s for TransferSingle events TO the minter wallet.
// Accepts up to POOL_MAX, returns everything over.

async function returnToken(toAddress, amount) {
  const walletClient = getMinterClient();
  if (!walletClient) return;
  const minterAddr = walletClient.account.address;
  try {
    const hash = await walletClient.writeContract({
      address: TOKEN_CONTRACT, abi: ERC1155_ABI, functionName: 'safeTransferFrom',
      args: [minterAddr, toAddress, TOKEN_ID, BigInt(amount), '0x'],
    });
    console.log(`[pool] returned ${amount} token(s) to ${toAddress} — tx ${hash}`);
    return hash;
  } catch (err) {
    console.error(`[pool] return failed for ${toAddress}:`, err.message);
  }
}

async function sendBatchToDead(count) {
  const walletClient = getMinterClient();
  if (!walletClient) return;
  const minterAddr = walletClient.account.address;
  try {
    const hash = await walletClient.writeContract({
      address: TOKEN_CONTRACT, abi: ERC1155_ABI, functionName: 'safeTransferFrom',
      args: [minterAddr, DEAD_ADDRESS, TOKEN_ID, BigInt(count), '0x'],
    });
    setPoolBatchSent();
    console.log(`[pool] batch-burned ${count} tokens to dead — tx ${hash}`);
    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🔥 **POOL COMPLETE** — ${count} tokens batch-burned!\n🔗 [BaseScan](https://basescan.org/tx/${hash})` }),
      }).catch(() => {});
    }
    return hash;
  } catch (err) {
    console.error('[pool] batch burn failed:', err.message);
  }
}

async function scanPoolTransfers() {
  const status = getBurnStatus();
  if (!status.poolOpen && !status.poolBatchSent) return; // nothing to do
  if (status.poolBatchSent) return; // already done

  const minterAddress = getMinterAddress();
  if (!minterAddress) return;

  let currentBlock;
  try { currentBlock = await publicClient.getBlockNumber(); } catch { return; }

  const lastBlock = getPoolLastBlock();
  if (currentBlock <= lastBlock) return;

  let logs;
  try {
    logs = await publicClient.getLogs({
      address: TOKEN_CONTRACT,
      event: TRANSFER_SINGLE,
      args: { to: minterAddress },
      fromBlock: lastBlock + 1n,
      toBlock: currentBlock,
    });
  } catch (err) {
    console.error('[pool] getLogs error:', err.message);
    return;
  }

  setPoolLastBlock(currentBlock);

  const relevant = logs.filter(l => l.args.id === TOKEN_ID);
  if (relevant.length === 0) return;

  for (const log of relevant) {
    const sender = log.args.from.toLowerCase();
    const txHash = log.transactionHash.toLowerCase();
    const amount = Number(log.args.value);

    // Skip self-transfers (the batch burn itself triggers this event)
    if (sender === minterAddress) continue;
    if (hasPoolTx(txHash)) continue;

    const fresh = getBurnStatus();
    const poolFull    = fresh.poolCount >= POOL_MAX;
    const alreadyIn   = hasWalletPool(sender);

    if (!fresh.poolOpen) {
      // Pool was closed while scanning — return this one
      console.log(`[pool] pool closed, returning to ${sender}`);
      recordPoolBurn(sender, txHash, 'returned_pool_closed');
      returnToken(sender, amount).catch(() => {});
      continue;
    }

    if (poolFull || alreadyIn) {
      const reason = alreadyIn ? 'already_in_pool' : 'pool_full';
      console.log(`[pool] ${reason}, returning to ${sender}`);
      recordPoolBurn(sender, txHash, reason);
      returnToken(sender, amount).catch(() => {});
      if (DISCORD_WEBHOOK) {
        const msg = alreadyIn
          ? `↩️ **POOL RETURN** — \`${sender.slice(0,6)}…${sender.slice(-4)}\` already in pool, token returned`
          : `↩️ **POOL FULL** — \`${sender.slice(0,6)}…${sender.slice(-4)}\` came in late, token returned`;
        fetch(DISCORD_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:msg}) }).catch(()=>{});
      }
    } else {
      // Accept
      recordPoolBurn(sender, txHash, 'accepted');
      console.log(`[pool] accepted ${sender} (${fresh.poolCount + 1}/${POOL_MAX})`);

      // Mint immediately
      mintManifoldNFT(sender, 'pool').catch(() => {});

      if (DISCORD_WEBHOOK) {
        const msg = `🎟️ **POOL SLOT** — \`${sender.slice(0,6)}…${sender.slice(-4)}\` claimed slot ${fresh.poolCount + 1}/${POOL_MAX}`;
        fetch(DISCORD_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:msg}) }).catch(()=>{});
      }

      // Check if pool is now full
      const newCount = fresh.poolCount + 1;
      if (newCount >= POOL_MAX) {
        console.log('[pool] pool full — batch burning to dead address');
        setPoolOpen(false);
        setTimeout(() => sendBatchToDead(POOL_MAX).catch(e => console.error('[pool] batch burn error:', e.message)), 3000);
      }
    }
  }
}

// Start scanner interval
let poolScannerInterval = null;
function startPoolScanner() {
  if (poolScannerInterval) return;
  poolScannerInterval = setInterval(() => scanPoolTransfers().catch(e => console.error('[pool] scanner error:', e.message)), 30_000);
  // Run once immediately
  scanPoolTransfers().catch(() => {});
  console.log('[pool] scanner started');
}
function stopPoolScanner() {
  if (poolScannerInterval) { clearInterval(poolScannerInterval); poolScannerInterval = null; }
  console.log('[pool] scanner stopped');
}

// Auto-start scanner on boot if pool was open
if (getBurnStatus().poolOpen) startPoolScanner();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const verifyBurnTx = async (txHash, expectedTier, attempt=0) => {
  const MAX_ATTEMPTS=5, DELAY_MS=3000;
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== 'success') return null;
    const logs = await publicClient.getLogs({ address: TOKEN_CONTRACT, event: TRANSFER_SINGLE, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
    const log  = logs.find(l => l.transactionHash.toLowerCase() === txHash.toLowerCase() && l.args.to?.toLowerCase() === DEAD_ADDRESS && l.args.id === TOKEN_ID);
    if (!log) return null;
    const amount = Number(log.args.value);
    if (expectedTier===1 && amount!==1) return null;
    if (expectedTier===2 && amount!==2) return null;
    return { wallet: log.args.from, amount };
  } catch (err) {
    if (attempt<MAX_ATTEMPTS && err.message?.includes('block range')) {
      await sleep(DELAY_MS); return verifyBurnTx(txHash, expectedTier, attempt+1);
    }
    console.error('TX verify error:', err.message); return null;
  }
};

const sendDiscord = async (wallet, tier, txHash, burn2Remaining) => {
  if (!DISCORD_WEBHOOK) return;
  const short  = `\`${wallet.slice(0,6)}…${wallet.slice(-4)}\``;
  const txLink = `https://basescan.org/tx/${txHash}`;
  const content = tier===2
    ? `🔥 **BURN ×2** — ${short} burned **2 tokens**!\n📦 Slots left: **${burn2Remaining}/${MAX_BURN2}**\n🔗 [BaseScan](${txLink})`
    : `🔥 **BURN ×1** — ${short} burned **1 token**\n🔗 [BaseScan](${txLink})`;
  await fetch(DISCORD_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content}) }).catch(e=>console.error('Discord:',e.message));
};

// ─── OpenSea ──────────────────────────────────────────────────────────────────
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || null;
const parseOpenSeaUrl = (url) => {
  const match = url.trim().match(/opensea\.io\/(?:assets|item)\/([a-zA-Z0-9_-]+)\/(0x[a-fA-F0-9]{40})\/(\d+)/);
  if (!match) return null;
  return { chain: match[1], contract: match[2], tokenId: match[3] };
};
const fetchOpenSeaNFT = async (openseaUrl) => {
  const parsed = parseOpenSeaUrl(openseaUrl);
  if (!parsed) return { openseaUrl, name:null, imageUrl:null, error:'Could not parse OpenSea URL' };
  const { chain, contract, tokenId } = parsed;
  try {
    const r = await fetch(`https://api.opensea.io/api/v2/chain/${chain}/contract/${contract}/nfts/${tokenId}`, {
      headers: OPENSEA_API_KEY ? { 'x-api-key': OPENSEA_API_KEY } : {},
    });
    if (!r.ok) return { openseaUrl, name:null, imageUrl:null, error:`OpenSea API ${r.status}` };
    const data = await r.json();
    const nft  = data.nft || {};
    return { openseaUrl, name: nft.name||`#${tokenId}`, imageUrl: nft.image_url||null, error: nft.image_url?null:'No image' };
  } catch (err) {
    return { openseaUrl, name:null, imageUrl:null, error:err.message };
  }
};

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => res.json(getBurnStatus()));

app.get('/slideshow', (_req, res) => res.json(getSlideshowItems().filter(i=>!!i.imageUrl)));

app.get('/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  const known = db.prepare('SELECT 1 FROM slideshow_items WHERE image_url=?').get(url);
  if (!known) return res.status(403).send('URL not allowed');
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type')||'image/png');
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=3600');
    res.send(buf);
  } catch { res.status(502).send('Proxy fetch failed'); }
});

app.get('/burns/wallet/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const burns   = db.prepare('SELECT tier FROM burns WHERE wallet=?').all(address);
  const pool    = hasWalletPool(address);
  res.json({ burnedTier1: burns.some(b=>b.tier===1), burnedTier2: burns.some(b=>b.tier===2), inPool: pool });
});

app.post('/burns', async (req, res) => {
  const { txHash, tier } = req.body;
  if (!txHash || ![1,2].includes(tier)) return res.status(400).json({ error:'txHash and tier (1|2) required' });
  const status = getBurnStatus();
  if (!status.eventLive)     return res.status(400).json({ error:'Burn event is not live yet' });
  if (tier===1 && !status.burn1Open) return res.status(400).json({ error:'Burn 1 is currently closed' });
  if (tier===2 && !status.burn2Open) return res.status(400).json({ error:`Burn 2 is full (${MAX_BURN2}/${MAX_BURN2})` });
  if (hasTx(txHash))         return res.status(400).json({ error:'TX already recorded' });
  const verified = await verifyBurnTx(txHash, tier);
  if (!verified)             return res.status(400).json({ error:'On-chain verification failed' });
  if (tier===1 && hasWalletBurned1(verified.wallet)) return res.status(400).json({ error:'Wallet already burned ×1 (one per wallet)' });
  recordBurn(verified.wallet, tier, txHash, verified.amount);
  mintManifoldNFT(verified.wallet, tier).catch(()=>{});
  const fresh = getBurnStatus();
  await sendDiscord(verified.wallet, tier, txHash, MAX_BURN2 - fresh.burn2Count);
  res.json({ success:true, wallet:verified.wallet });
});

// ─── Admin ────────────────────────────────────────────────────────────────────
app.post('/admin/burn1/close', requireAdmin, (_req,res) => { stopBurn1Timer(); res.json({burn1Open:false}); });
app.post('/admin/burn1/open',  requireAdmin, (_req,res) => { setBurn1Open(true); res.json({burn1Open:true}); });

app.post('/admin/timer/:action', requireAdmin, (req,res) => {
  if (req.params.action==='start') { const end=startBurn1Timer(24); res.json({success:true,timerEnd:end,burn1Open:true}); }
  else if (req.params.action==='stop') { stopBurn1Timer(); res.json({success:true,burn1Open:false,timerEnd:null}); }
  else res.status(400).json({error:'Invalid action'});
});

// Pool admin
app.post('/admin/pool/start', requireAdmin, (req,res) => {
  setPoolOpen(true);
  startPoolScanner();
  console.log('[pool] opened by admin');
  res.json({ success:true, poolOpen:true });
});
app.post('/admin/pool/stop', requireAdmin, (req,res) => {
  setPoolOpen(false);
  stopPoolScanner();
  console.log('[pool] closed by admin');
  res.json({ success:true, poolOpen:false });
});
app.get('/admin/pool/burns', requireAdmin, (_req,res) => res.json(getPoolBurns()));

app.post('/admin/event/go-live',     requireAdmin, (_req,res) => { setEventLive(true);  res.json({eventLive:true}); });
app.post('/admin/event/coming-soon', requireAdmin, (_req,res) => { setEventLive(false); res.json({eventLive:false}); });

app.post('/admin/slideshow', requireAdmin, async (req,res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) return res.status(400).json({error:'urls must be an array'});
  const results = [];
  for (const url of urls.map(u=>String(u).trim()).filter(Boolean)) results.push(await fetchOpenSeaNFT(url));
  replaceSlideshowItems(results.map(r=>({openseaUrl:r.openseaUrl,name:r.name,imageUrl:r.imageUrl})));
  res.json({success:true,results});
});

app.get('/admin/burns',        requireAdmin, (_req,res) => res.json(getAllBurns()));
app.get('/admin/burns/export', requireAdmin, (_req,res) => {
  const burns = getAllBurns();
  const lines = ['wallet,tier,tx_hash,amount,confirmed_at', ...burns.map(b=>`${b.wallet},${b.tier},${b.tx_hash},${b.amount},"${b.confirmed_at}"`)];
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="burns.csv"');
  res.send(lines.join('\n'));
});

app.post('/admin/remint', requireAdmin, async (_req,res) => {
  const burns=getAllBurns(), results=[];
  for (const burn of burns) {
    try { await mintManifoldNFT(burn.wallet,burn.tier); results.push({wallet:burn.wallet,tier:burn.tier,status:'minted'}); }
    catch (err) { results.push({wallet:burn.wallet,tier:burn.tier,status:'failed',error:err.message}); }
  }
  res.json({success:true,results});
});

app.get('/health', (_req,res) => res.json({ok:true}));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🔥 Burn API listening on :${PORT}`));
