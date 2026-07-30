const express   = require('express');
const cors      = require('cors');
const { createPublicClient, createWalletClient, http, parseAbiItem } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base, mainnet } = require('viem/chains');
const {
  db, getBurnStatus, recordBurn, setBurn1Open, setBurn2Open, setEventLive,
  startBurn1Timer, stopBurn1Timer, hasWalletBurned1,
  getAllBurns, hasTx, replaceSlideshowItems, getSlideshowItems,
} = require('./db');

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  process.env.BURN_SITE_URL,
  process.env.REVEAL_SITE_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.endsWith('.vercel.app'))
      return cb(null, true);
    cb(new Error('CORS'));
  },
}));

// ─── Constants ───────────────────────────────────────────────────────────────
const TOKEN_CONTRACT  = '0x04619852f38ebec22bb94ef36b99351db9900194';
const TOKEN_ID        = BigInt(3);
const DEAD_ADDRESS    = '0x000000000000000000000000000000000000dead';
const MAX_BURN2       = 5;
const ADMIN_KEY       = process.env.ADMIN_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

// ─── Manifold ────────────────────────────────────────────────────────────────
//
// TIER 2 (burn ×2) — existing contract, token #1
const MANIFOLD_T2_CONTRACT = process.env.MANIFOLD_CONTRACT_ADDRESS || null;
const MANIFOLD_T2_TOKEN_ID = BigInt(process.env.MANIFOLD_TOKEN_ID || '1');

// TIER 1 (burn ×1) — open-edition contract
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  SET THESE IN RAILWAY WHEN YOU HAVE THE TOKEN ID:                        │
// │  MANIFOLD_TIER1_CONTRACT_ADDRESS = 0x04619852f38EBEC22bb94eF36b99351dB9900194 │
// │  MANIFOLD_TIER1_TOKEN_ID         = ???  ← ASK YOUR FRIEND FOR THIS      │
// └──────────────────────────────────────────────────────────────────────────┘
const MANIFOLD_T1_CONTRACT = process.env.MANIFOLD_TIER1_CONTRACT_ADDRESS || null;
const MANIFOLD_T1_TOKEN_ID = BigInt(process.env.MANIFOLD_TIER1_TOKEN_ID || '0'); // 0 = not set yet

const MANIFOLD_CHAIN = process.env.MANIFOLD_CONTRACT_CHAIN === 'mainnet' ? mainnet : base;
const MINTER_KEY     = process.env.MINTER_PRIVATE_KEY || null;

const MANIFOLD_ABI = [
  {
    name: 'mintBaseExisting', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',       type: 'address[]' },
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'amounts',  type: 'uint256[]' },
    ],
    outputs: [],
  },
];

let minterClient = null;
function getMinterClient() {
  if (minterClient) return minterClient;
  if (!MINTER_KEY) return null;
  const account = privateKeyToAccount(
    MINTER_KEY.startsWith('0x') ? MINTER_KEY : '0x' + MINTER_KEY
  );
  minterClient = createWalletClient({
    account,
    chain:     MANIFOLD_CHAIN,
    transport: http(process.env.MANIFOLD_RPC_URL || undefined),
  });
  return minterClient;
}

const mintManifoldNFT = async (toAddress, tier) => {
  const walletClient = getMinterClient();
  if (!walletClient) {
    console.log(`[manifold] skipped — no minter key`);
    return;
  }

  // Route by tier
  const contract = tier === 1 ? MANIFOLD_T1_CONTRACT : MANIFOLD_T2_CONTRACT;
  const tokenId  = tier === 1 ? MANIFOLD_T1_TOKEN_ID : MANIFOLD_T2_TOKEN_ID;

  if (!contract) {
    console.log(`[manifold] skipped tier ${tier} — contract not configured`);
    return;
  }
  if (tokenId === 0n) {
    // ⚠️  MANIFOLD_TIER1_TOKEN_ID not set in Railway yet — mint will be skipped
    console.warn(`[manifold] ⚠️  MANIFOLD_TIER1_TOKEN_ID is not set in Railway. Set it and use remint to catch up.`);
    return;
  }

  const hash = await walletClient.writeContract({
    address:      contract,
    abi:          MANIFOLD_ABI,
    functionName: 'mintBaseExisting',
    args:         [[toAddress], [tokenId], [1n]],
  });
  console.log(`[manifold] tier${tier} — minted token #${tokenId} to ${toAddress} — tx ${hash}`);
  return hash;
};

// ─── Viem read client ─────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

const TRANSFER_SINGLE = parseAbiItem(
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const verifyBurnTx = async (txHash, expectedTier, attempt = 0) => {
  const MAX_ATTEMPTS = 5;
  const DELAY_MS     = 3000;
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== 'success') return null;

    const logs = await publicClient.getLogs({
      address: TOKEN_CONTRACT,
      event:   TRANSFER_SINGLE,
      fromBlock: receipt.blockNumber,
      toBlock:   receipt.blockNumber,
    });

    const log = logs.find(l =>
      l.transactionHash.toLowerCase() === txHash.toLowerCase() &&
      l.args.to?.toLowerCase()        === DEAD_ADDRESS &&
      l.args.id                       === TOKEN_ID
    );

    if (!log) return null;

    const amount = Number(log.args.value);
    if (expectedTier === 1 && amount !== 1) return null;
    if (expectedTier === 2 && amount !== 2) return null;

    return { wallet: log.args.from, amount };
  } catch (err) {
    const retryable = err.message?.includes('block range') || err.message?.includes('could not be found');
    if (attempt < MAX_ATTEMPTS && retryable) {
      console.log(`[verify] RPC not ready, retrying in ${DELAY_MS}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
      await sleep(DELAY_MS);
      return verifyBurnTx(txHash, expectedTier, attempt + 1);
    }
    console.error('TX verify error:', err.message);
    return null;
  }
};

const sendDiscord = async (wallet, tier, txHash, burn2Remaining) => {
  if (!DISCORD_WEBHOOK) return;
  const short  = `\`${wallet.slice(0,6)}…${wallet.slice(-4)}\``;
  const txLink = `https://basescan.org/tx/${txHash}`;

  const content = tier === 2
    ? `🔥 **BURN ×2** — ${short} burned **2 tokens**!\n📦 Burn-2 slots left: **${burn2Remaining} / ${MAX_BURN2}**\n🔗 [BaseScan](${txLink})`
    : `🔥 **BURN ×1** — ${short} burned **1 token** (open edition)\n🔗 [BaseScan](${txLink})`;

  await fetch(DISCORD_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content }),
  }).catch(e => console.error('Discord error:', e.message));
};

// ─── OpenSea slideshow ────────────────────────────────────────────────────────
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || null;

const parseOpenSeaUrl = (url) => {
  const match = url.trim().match(
    /opensea\.io\/(?:assets|item)\/([a-zA-Z0-9_-]+)\/(0x[a-fA-F0-9]{40})\/(\d+)/
  );
  if (!match) return null;
  return { chain: match[1], contract: match[2], tokenId: match[3] };
};

const fetchOpenSeaNFT = async (openseaUrl) => {
  const parsed = parseOpenSeaUrl(openseaUrl);
  if (!parsed) return { openseaUrl, name: null, imageUrl: null, error: 'Could not parse OpenSea URL' };
  const { chain, contract, tokenId } = parsed;
  const apiUrl = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contract}/nfts/${tokenId}`;
  try {
    const r = await fetch(apiUrl, {
      headers: OPENSEA_API_KEY ? { 'x-api-key': OPENSEA_API_KEY } : {},
    });
    if (!r.ok) return { openseaUrl, name: null, imageUrl: null, error: `OpenSea API ${r.status}` };
    const data = await r.json();
    const nft  = data.nft || {};
    return {
      openseaUrl,
      name:     nft.name || `#${tokenId}`,
      imageUrl: nft.image_url || null,
      error:    nft.image_url ? null : 'No image returned by OpenSea',
    };
  } catch (err) {
    return { openseaUrl, name: null, imageUrl: null, error: err.message };
  }
};

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/status', (_req, res) => res.json(getBurnStatus()));

app.get('/slideshow', (_req, res) => {
  const items = getSlideshowItems().filter(i => !!i.imageUrl);
  res.json(items);
});

app.get('/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  const known = db.prepare('SELECT 1 FROM slideshow_items WHERE image_url = ?').get(url);
  if (!known) return res.status(403).send('URL not allowed');
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error');
    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (err) {
    res.status(502).send('Proxy fetch failed');
  }
});

app.get('/burns/wallet/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const burns   = db.prepare('SELECT tier FROM burns WHERE wallet = ?').all(address);
  res.json({
    burnedTier1: burns.some(b => b.tier === 1),
    burnedTier2: burns.some(b => b.tier === 2),
  });
});

app.post('/burns', async (req, res) => {
  const { txHash, tier } = req.body;

  if (!txHash || ![1, 2].includes(tier))
    return res.status(400).json({ error: 'txHash and tier (1|2) required' });

  const status = getBurnStatus();
  if (!status.eventLive)
    return res.status(400).json({ error: 'Burn event is not live yet' });
  if (tier === 1 && !status.burn1Open)
    return res.status(400).json({ error: 'Burn 1 is currently closed' });
  if (tier === 2 && !status.burn2Open)
    return res.status(400).json({ error: 'Burn 2 is closed' });
  if (hasTx(txHash))
    return res.status(400).json({ error: 'TX already recorded' });

  const verified = await verifyBurnTx(txHash, tier);
  if (!verified)
    return res.status(400).json({ error: 'On-chain verification failed' });

  // One burn ×1 per wallet — open edition hard limit
  if (tier === 1 && hasWalletBurned1(verified.wallet))
    return res.status(400).json({ error: 'This wallet has already burned ×1 (one per wallet)' });

  try {
    recordBurn(verified.wallet, tier, txHash, verified.amount);
  } catch (err) {
    if (String(err.message).includes('UNIQUE'))
      return res.status(400).json({ error: 'This wallet has already burned ×1 (one per wallet)' });
    console.error('recordBurn error:', err.message);
    return res.status(500).json({ error: 'Failed to record burn — contact admin with your tx hash' });
  }
  mintManifoldNFT(verified.wallet, tier).catch(() => {});

  const fresh = getBurnStatus();
  await sendDiscord(verified.wallet, tier, txHash, MAX_BURN2 - fresh.burn2Count);

  res.json({ success: true, wallet: verified.wallet });
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

app.post('/admin/burn1/close', requireAdmin, (_req, res) => {
  stopBurn1Timer();
  res.json({ burn1Open: false });
});
app.post('/admin/burn1/open', requireAdmin, (_req, res) => {
  setBurn1Open(true);
  res.json({ burn1Open: true });
});

app.post('/admin/burn2/close', requireAdmin, (_req, res) => {
  setBurn2Open(false);
  res.json({ burn2Open: false });
});
app.post('/admin/burn2/open', requireAdmin, (_req, res) => {
  setBurn2Open(true);
  res.json({ burn2Open: true });
});

// Start the 24h burn ×1 open edition timer
app.post('/admin/timer/start', requireAdmin, (_req, res) => {
  const timerEnd = startBurn1Timer(24);
  res.json({ success: true, timerEnd, burn1Open: true });
});
app.post('/admin/timer/stop', requireAdmin, (_req, res) => {
  stopBurn1Timer();
  res.json({ success: true, burn1Open: false, timerEnd: null });
});

app.post('/admin/event/go-live',     requireAdmin, (_req, res) => { setEventLive(true);  res.json({ eventLive: true  }); });
app.post('/admin/event/coming-soon', requireAdmin, (_req, res) => { setEventLive(false); res.json({ eventLive: false }); });

app.post('/admin/slideshow', requireAdmin, async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls))
    return res.status(400).json({ error: 'urls must be an array of strings' });
  const cleanUrls = urls.map(u => String(u).trim()).filter(Boolean);
  const results   = [];
  for (const url of cleanUrls) results.push(await fetchOpenSeaNFT(url));
  replaceSlideshowItems(results.map(r => ({ openseaUrl: r.openseaUrl, name: r.name, imageUrl: r.imageUrl })));
  res.json({ success: true, results });
});

app.get('/admin/burns', requireAdmin, (_req, res) => res.json(getAllBurns()));

app.post('/admin/remint', requireAdmin, async (req, res) => {
  const burns   = getAllBurns();
  const results = [];
  for (const burn of burns) {
    try {
      await mintManifoldNFT(burn.wallet, burn.tier);
      results.push({ wallet: burn.wallet, tier: burn.tier, status: 'minted' });
      console.log(`[remint] minted to ${burn.wallet}`);
    } catch (err) {
      results.push({ wallet: burn.wallet, tier: burn.tier, status: 'failed', error: err.message });
      console.error(`[remint] failed for ${burn.wallet}:`, err.message);
    }
  }
  res.json({ success: true, results });
});

// Mint without a burn — verifies the minter wallet can mint on the real
// contract before the event. Does NOT touch the burns table, so it never
// affects the one-burn-per-wallet limit.
app.post('/admin/testmint', requireAdmin, async (req, res) => {
  const { wallet, tier } = req.body;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet))
    return res.status(400).json({ error: 'wallet must be a 0x address' });
  const t = tier === 2 ? 2 : 1;
  try {
    const txHash = await mintManifoldNFT(wallet, t);
    if (!txHash)
      return res.status(400).json({ error: `Mint skipped — minter key, tier ${t} contract, or token ID not configured` });
    res.json({ success: true, wallet, tier: t, txHash });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/remint/:wallet', requireAdmin, async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  const burn   = getAllBurns().find(b => b.wallet.toLowerCase() === wallet);
  if (!burn) return res.status(404).json({ error: 'Wallet not found' });
  try {
    await mintManifoldNFT(burn.wallet, burn.tier);
    res.json({ success: true, wallet: burn.wallet });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/admin/burns/export', requireAdmin, (_req, res) => {
  const burns = getAllBurns();
  const lines = [
    'wallet,tier,tx_hash,amount,confirmed_at',
    ...burns.map(b => `${b.wallet},${b.tier},${b.tx_hash},${b.amount},"${b.confirmed_at}"`),
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="burns.csv"');
  res.send(lines.join('\n'));
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🔥 Burn API listening on :${PORT}`));
