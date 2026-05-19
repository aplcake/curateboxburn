const express   = require('express');
const cors      = require('cors');
const { createPublicClient, http, parseAbiItem } = require('viem');
const { base }  = require('viem/chains');
const { getBurnStatus, recordBurn, setBurn1Open, getAllBurns, hasTx } = require('./db');

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

const verifyBurnTx = async (txHash, expectedTier) => {
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

// ─── Routes ─────────────────────────────────────────────────────────────────

// Public: burn counts / open-state
app.get('/status', (_req, res) => res.json(getBurnStatus()));

// Public: submit a confirmed burn for recording
app.post('/burns', async (req, res) => {
  const { txHash, tier } = req.body;

  if (!txHash || ![1, 2].includes(tier))
    return res.status(400).json({ error: 'txHash and tier (1|2) required' });

  const status = getBurnStatus();
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

  const fresh = getBurnStatus();
  await sendDiscord(verified.wallet, tier, txHash, MAX_BURN2 - fresh.burn2Count);

  res.json({ success: true, wallet: verified.wallet });
});

// Admin: toggle burn 1
app.post('/admin/burn1/close',  requireAdmin, (_req, res) => { setBurn1Open(false); res.json({ burn1Open: false }); });
app.post('/admin/burn1/open',   requireAdmin, (_req, res) => { setBurn1Open(true);  res.json({ burn1Open: true  }); });

// Admin: list all burns (JSON)
app.get('/admin/burns', requireAdmin, (_req, res) => res.json(getAllBurns()));

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
