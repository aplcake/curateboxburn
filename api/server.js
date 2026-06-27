const express   = require('express');
const cors      = require('cors');
const { createPublicClient, createWalletClient, http, parseAbiItem } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base, mainnet } = require('viem/chains');
const { db, getBurnStatus, recordBurn, setBurn1Open, setEventLive, getAllBurns, hasTx, replaceSlideshowItems, getSlideshowItems } = require('./db');

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  process.env.BURN_SITE_URL,
  process.env.REVEAL_SITE_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // dev: allow all
    if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.endsWith('.vercel.app'))
      return cb(null, true);
    cb(new Error('CORS'));
  },
}));

// ─── Constants ──────────────────────────────────────────────────────────────
const TOKEN_CONTRACT  = '0x04619852f38ebec22bb94ef36b99351db9900194';
const TOKEN_ID        = BigInt(3);
const DEAD_ADDRESS    = '0x000000000000000000000000000000000000dead';
const MAX_BURN2       = 5;
const ADMIN_KEY       = process.env.ADMIN_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

// ─── Manifold auto-mint ──────────────────────────────────────────────────────
// Set these env vars in Railway once you have the Manifold contract ready:
//   MANIFOLD_CONTRACT_ADDRESS  — your Manifold ERC-721 contract address
//   MANIFOLD_CONTRACT_CHAIN    — 'base' | 'mainnet' (default: 'base')
//   MINTER_PRIVATE_KEY         — private key of wallet with admin role on Manifold
//   MANIFOLD_RPC_URL           — optional custom RPC for the mint chain

const MANIFOLD_CONTRACT = process.env.MANIFOLD_CONTRACT_ADDRESS || null;
const MANIFOLD_CHAIN    = process.env.MANIFOLD_CONTRACT_CHAIN === 'mainnet' ? mainnet : base;
const MINTER_KEY        = process.env.MINTER_PRIVATE_KEY || null;

// Manifold ERC-1155 Creator Core: mintBaseExisting — mints token ID 1 to each burner
const MANIFOLD_TOKEN_ID = BigInt(process.env.MANIFOLD_TOKEN_ID || '1');
const MANIFOLD_ABI = [
  {
    name: 'mintBaseExisting', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',        type: 'address[]' },
      { name: 'tokenIds',  type: 'uint256[]' },
      { name: 'amounts',   type: 'uint256[]' },
    ],
    outputs: [],
  },
];

// Lazily-created wallet client (only if env vars are set)
let minterClient = null;
function getMinterClient() {
  if (minterClient) return minterClient;
  if (!MINTER_KEY || !MANIFOLD_CONTRACT) return null;

  const account = privateKeyToAccount(MINTER_KEY.startsWith('0x') ? MINTER_KEY : '0x' + MINTER_KEY);
  minterClient  = createWalletClient({
    account,
    chain:     MANIFOLD_CHAIN,
    transport: http(process.env.MANIFOLD_RPC_URL || undefined),
  });
  return minterClient;
}

// Mint one NFT to `toAddress` via the Manifold contract.
// Fires and forgets — burn recording is never blocked by mint failures.
const mintManifoldNFT = async (toAddress, tier) => {
  const client = getMinterClient();
  if (!client || !MANIFOLD_CONTRACT) {
    console.log(`[manifold] skipped — contract: ${MANIFOLD_CONTRACT}, key set: ${!!MINTER_KEY}`);
    return;
  }
  // mintBaseExisting(address[] to, uint256[] tokenIds, uint256[] amounts)
  const hash = await client.writeContract({
    address:      MANIFOLD_CONTRACT,
    abi:          MANIFOLD_ABI,
    functionName: 'mintBaseExisting',
    args:         [[toAddress], [MANIFOLD_TOKEN_ID], [1n]],
  });

  console.log(`[manifold] minted token #${MANIFOLD_TOKEN_ID} to ${toAddress} (tier ${tier}) — tx ${hash}`);
};


// ─── Viem client ────────────────────────────────────────────────────────────
const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

const TRANSFER_SINGLE = parseAbiItem(
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
);

// ─── Helpers ────────────────────────────────────────────────────────────────
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
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== 'success') return null;

    const logs = await client.getLogs({
      address: TOKEN_CONTRACT,
      event: TRANSFER_SINGLE,
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
    if (attempt < MAX_ATTEMPTS && err.message?.includes('block range')) {
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
    : `🔥 **BURN ×1** — ${short} burned **1 token**\n🔗 [BaseScan](${txLink})`;

  await fetch(DISCORD_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content }),
  }).catch(e => console.error('Discord error:', e.message));
};

// ─── OpenSea slideshow resolver ───────────────────────────────────────────────
// Accepts links like:
//   https://opensea.io/assets/base/0xCONTRACT/123
//   https://opensea.io/item/base/0xCONTRACT/123
// and resolves them to a display name + image URL via the OpenSea API.
// OPENSEA_API_KEY is optional but strongly recommended — OpenSea heavily
// rate-limits/blocks unauthenticated requests.
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
    if (!r.ok) {
      return { openseaUrl, name: null, imageUrl: null, error: `OpenSea API ${r.status}` };
    }
    const data = await r.json();
    const nft = data.nft || {};
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

// ─── Routes ─────────────────────────────────────────────────────────────────

// Public: burn counts / open-state
app.get('/status', (_req, res) => res.json(getBurnStatus()));

// Public: slideshow images for the room display (only items that resolved)
app.get('/slideshow', (_req, res) => {
  const items = getSlideshowItems().filter(i => !!i.imageUrl);
  res.json(items);
});

// Public: proxies a slideshow image so the browser can load it as a WebGL
// texture. OpenSea's image CDN often doesn't send permissive CORS headers,
// which makes Three.js's TextureLoader fail silently — proxying through our
// own server with an explicit Access-Control-Allow-Origin sidesteps that.
// Only proxies URLs we've actually stored, so this can't be used as an open proxy.
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
    console.error('[image-proxy] failed:', err.message);
    res.status(502).send('Proxy fetch failed');
  }
});

// Public: check what a specific wallet has already burned
app.get('/burns/wallet/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const burns = db.prepare('SELECT tier FROM burns WHERE wallet = ?').all(address);
  res.json({
    burnedTier1: burns.some(b => b.tier === 1),
    burnedTier2: burns.some(b => b.tier === 2),
  });
});

// Public: submit a confirmed burn for recording
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
    return res.status(400).json({ error: `Burn 2 is full (${MAX_BURN2}/${MAX_BURN2})` });
  if (hasTx(txHash))
    return res.status(400).json({ error: 'TX already recorded' });

  const verified = await verifyBurnTx(txHash, tier);
  if (!verified)
    return res.status(400).json({ error: 'On-chain verification failed' });

  recordBurn(verified.wallet, tier, txHash, verified.amount);

  // Fire Manifold mint (non-blocking — burn is already recorded)
  mintManifoldNFT(verified.wallet, tier).catch(() => {});

  const fresh = getBurnStatus();
  await sendDiscord(verified.wallet, tier, txHash, MAX_BURN2 - fresh.burn2Count);

  res.json({ success: true, wallet: verified.wallet });
});

// Admin: toggle burn 1
app.post('/admin/burn1/close',  requireAdmin, (_req, res) => { setBurn1Open(false); res.json({ burn1Open: false }); });
app.post('/admin/burn1/open',   requireAdmin, (_req, res) => { setBurn1Open(true);  res.json({ burn1Open: true  }); });

// Admin: toggle whole event live / coming-soon
app.post('/admin/event/go-live',     requireAdmin, (_req, res) => { setEventLive(true);  res.json({ eventLive: true  }); });
app.post('/admin/event/coming-soon', requireAdmin, (_req, res) => { setEventLive(false); res.json({ eventLive: false }); });

// Admin: save the slideshow — pastes a fresh list of OpenSea links, resolves
// each via the OpenSea API, replaces the stored set entirely.
app.post('/admin/slideshow', requireAdmin, async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls))
    return res.status(400).json({ error: 'urls must be an array of strings' });

  const cleanUrls = urls.map(u => String(u).trim()).filter(Boolean);
  const results = [];
  for (const url of cleanUrls) {
    const resolved = await fetchOpenSeaNFT(url);
    results.push(resolved);
  }

  replaceSlideshowItems(results.map(r => ({
    openseaUrl: r.openseaUrl,
    name:       r.name,
    imageUrl:   r.imageUrl,
  })));

  res.json({ success: true, results });
});

// Admin: list all burns (JSON)
app.get('/admin/burns', requireAdmin, (_req, res) => res.json(getAllBurns()));


// Admin: remint airdrop to all recorded burns (for burns that happened before Manifold was wired)
app.post('/admin/remint', requireAdmin, async (req, res) => {
  const burns = getAllBurns();
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

// Admin: remint a single wallet
app.post('/admin/remint/:wallet', requireAdmin, async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();

  const burn = getAllBurns().find(
    b => b.wallet.toLowerCase() === wallet
  );

  if (!burn) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  try {
    await mintManifoldNFT(burn.wallet, burn.tier);

    console.log(`[manual-remint] minted to ${burn.wallet}`);

    res.json({
      success: true,
      wallet: burn.wallet
    });
  } catch (err) {
    console.error(`[manual-remint] failed for ${burn.wallet}:`, err.message);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Admin: download CSV
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

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🔥 Burn API listening on :${PORT}`));
