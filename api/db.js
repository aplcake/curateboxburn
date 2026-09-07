const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'burns.db');
const db = new Database(DB_PATH);
const INITIAL_POOL_COUNT = Number.parseInt(process.env.INITIAL_POOL_COUNT || '2', 10);
const SAFE_INITIAL_POOL_COUNT = Number.isInteger(INITIAL_POOL_COUNT)
  ? Math.max(0, Math.min(INITIAL_POOL_COUNT, 10))
  : 2;

db.exec(`
  CREATE TABLE IF NOT EXISTS burns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet       TEXT    NOT NULL,
    tier         INTEGER NOT NULL CHECK(tier IN (1, 2)),
    tx_hash      TEXT    UNIQUE NOT NULL,
    amount       INTEGER NOT NULL,
    confirmed_at TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slideshow_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    opensea_url TEXT    NOT NULL,
    name        TEXT,
    image_url   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pool_burns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet     TEXT NOT NULL,
    tx_hash    TEXT UNIQUE NOT NULL,
    status     TEXT NOT NULL DEFAULT 'accepted',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO config (key, value) VALUES ('burn1_open',      'true');
  INSERT OR IGNORE INTO config (key, value) VALUES ('burn2_open',      'true');
  INSERT OR IGNORE INTO config (key, value) VALUES ('burn2_count',     '0');
  INSERT OR IGNORE INTO config (key, value) VALUES ('event_live',      'false');
  INSERT OR IGNORE INTO config (key, value) VALUES ('burn1_timer_end', '');
  INSERT OR IGNORE INTO config (key, value) VALUES ('pool_open',       'false');
  INSERT OR IGNORE INTO config (key, value) VALUES ('pool_count',      '0');
  INSERT OR IGNORE INTO config (key, value) VALUES ('pool_batch_sent', 'false');
  INSERT OR IGNORE INTO config (key, value) VALUES ('pool_last_block', '0');
`);

// This event already has two FCFS commitments. Only initialise a completely
// empty pool, so deploys never overwrite a pool that has begun accepting users.
const poolState = db.prepare("SELECT value FROM config WHERE key = 'pool_count'").get();
const poolRows = db.prepare('SELECT COUNT(*) AS count FROM pool_burns').get();
if (poolState?.value === '0' && poolRows.count === 0 && SAFE_INITIAL_POOL_COUNT > 0) {
  db.prepare("UPDATE config SET value = ? WHERE key = 'pool_count'").run(String(SAFE_INITIAL_POOL_COUNT));
  console.log(`[db] initialized pool with ${SAFE_INITIAL_POOL_COUNT} committed slots`);
}

const CONFIRMED_BURNS = [
  { wallet: '0x7ea0ccda3930abca0e6cb57f98e30ebcb708dd60', tier: 2, tx_hash: '0xadd5fb39a08cd4c009773f001ceabd91e65c15cd17599f1a4d78938202de6a68', amount: 2 },
  { wallet: '0x3c785af6a41490c24d6910bfa9baffabd1dd2f21', tier: 2, tx_hash: '0x571f88342d2884c13a128b6a7262d2a82b69390453e7d5143c6ebf6e22273d37', amount: 2 },
];
// This event allows repeat burns. Drop the legacy one-burn-per-wallet index on
// startup so existing Railway databases receive the policy change as well.
db.exec('DROP INDEX IF EXISTS one_burn1_per_wallet;');

const insertSeed = db.prepare('INSERT OR IGNORE INTO burns (wallet, tier, tx_hash, amount) VALUES (?, ?, ?, ?)');
for (const b of CONFIRMED_BURNS) {
  if (insertSeed.run(b.wallet, b.tier, b.tx_hash, b.amount).changes > 0)
    console.log(`[db] seeded burn: ${b.wallet}`);
}

const getConfig = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value;
const setConfig = db.prepare('UPDATE config SET value = ? WHERE key = ?');

function checkTimerExpiry() {
  const end = getConfig('burn1_timer_end');
  if (!end) return;
  if (Date.now() > new Date(end).getTime() && getConfig('burn1_open') === 'true') {
    setConfig.run('false', 'burn1_open');
    setConfig.run('', 'burn1_timer_end');
    console.log('[timer] burn1 auto-closed');
  }
}

const getBurnStatus = () => {
  checkTimerExpiry();
  const burn2Count = parseInt(getConfig('burn2_count') || '0');
  const poolCount  = parseInt(getConfig('pool_count')  || '0');
  return {
    eventLive:     getConfig('event_live')      === 'true',
    burn1Open:     getConfig('burn1_open')      === 'true',
    timerEnd:      getConfig('burn1_timer_end') || null,
    burn2Count,
    burn2Open:     getConfig('burn2_open') === 'true' && burn2Count < 5,
    totalBurn1:    db.prepare("SELECT COUNT(*) AS c FROM burns WHERE tier = 1").get().c,
    totalBurn2:    db.prepare("SELECT COUNT(*) AS c FROM burns WHERE tier = 2").get().c,
    poolOpen:      getConfig('pool_open')       === 'true',
    poolCount,
    poolMax:       10,
    poolBatchSent: getConfig('pool_batch_sent') === 'true',
  };
};

const recordBurn = (wallet, tier, txHash, amount) => {
  db.prepare('INSERT INTO burns (wallet, tier, tx_hash, amount) VALUES (?, ?, ?, ?)')
    .run(wallet.toLowerCase(), tier, txHash.toLowerCase(), amount);
  if (tier === 2) {
    const cur = parseInt(getConfig('burn2_count') || '0');
    setConfig.run(String(cur + 1), 'burn2_count');
  }
};

const setBurn1Open     = (open) => setConfig.run(open ? 'true' : 'false', 'burn1_open');
const setBurn2Open     = (open) => setConfig.run(open ? 'true' : 'false', 'burn2_open');
const setEventLive     = (live) => setConfig.run(live ? 'true' : 'false', 'event_live');
const startBurn1Timer  = (h=24) => {
  const end = new Date(Date.now() + h*3600000).toISOString();
  setConfig.run('true', 'burn1_open');
  setConfig.run(end, 'burn1_timer_end');
  return end;
};
const stopBurn1Timer   = () => {
  setConfig.run('false', 'burn1_open');
  setConfig.run('', 'burn1_timer_end');
};
const getAllBurns       = () => db.prepare('SELECT * FROM burns ORDER BY created_at ASC').all();
const hasTx            = (h) => !!db.prepare('SELECT id FROM burns WHERE tx_hash=?').get(h.toLowerCase());

// ── Pool ─────────────────────────────────────────────────────────────────────
const hasPoolTx     = (h) => !!db.prepare('SELECT 1 FROM pool_burns WHERE tx_hash=?').get(h.toLowerCase());
const hasWalletPool = (w) => !!db.prepare("SELECT 1 FROM pool_burns WHERE wallet=? AND status='accepted'").get(w.toLowerCase());
const getPoolBurns  = () => db.prepare('SELECT * FROM pool_burns ORDER BY created_at ASC').all();
const recordPoolBurn = (wallet, txHash, status='accepted') => {
  const result = db.prepare('INSERT OR IGNORE INTO pool_burns (wallet,tx_hash,status) VALUES (?,?,?)')
    .run(wallet.toLowerCase(), txHash.toLowerCase(), status);
  if (status === 'accepted' && result.changes === 1) {
    const cur = parseInt(getConfig('pool_count') || '0');
    setConfig.run(String(cur+1), 'pool_count');
  }
};
const setPoolOpen      = (v) => setConfig.run(v ? 'true' : 'false', 'pool_open');
const setPoolCount     = (count) => setConfig.run(String(count), 'pool_count');
const setPoolBatchSent = ()  => setConfig.run('true', 'pool_batch_sent');
const getPoolLastBlock = ()  => BigInt(getConfig('pool_last_block') || '0');
const setPoolLastBlock = (n) => setConfig.run(String(n), 'pool_last_block');

// ── Slideshow ─────────────────────────────────────────────────────────────────
const replaceSlideshowItems = db.transaction((items) => {
  db.prepare('DELETE FROM slideshow_items').run();
  const ins = db.prepare('INSERT INTO slideshow_items (opensea_url,name,image_url,sort_order) VALUES (?,?,?,?)');
  items.forEach((item, i) => ins.run(item.openseaUrl, item.name||null, item.imageUrl||null, i));
});
const getSlideshowItems = () =>
  db.prepare('SELECT id, opensea_url AS openseaUrl, name, image_url AS imageUrl FROM slideshow_items ORDER BY sort_order ASC').all();

module.exports = {
  db, getBurnStatus, recordBurn, setBurn1Open, setBurn2Open, setEventLive,
  startBurn1Timer, stopBurn1Timer, getAllBurns, hasTx,
  hasPoolTx, hasWalletPool, getPoolBurns, recordPoolBurn,
  setPoolOpen, setPoolCount, setPoolBatchSent, getPoolLastBlock, setPoolLastBlock,
  replaceSlideshowItems, getSlideshowItems,
};
