const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'burns.db');
const db = new Database(DB_PATH);

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

  INSERT OR IGNORE INTO config (key, value) VALUES ('burn1_open',  'true');
  INSERT OR IGNORE INTO config (key, value) VALUES ('burn2_count', '0');
  INSERT OR IGNORE INTO config (key, value) VALUES ('event_live',  'true');
`);

// Seed the two confirmed on-chain burns for raffle record-keeping.
// These do NOT increment burn2_count — counter stays fresh at 5/5.
const CONFIRMED_BURNS = [
  {
    wallet: '0x7ea0ccda3930abca0e6cb57f98e30ebcb708dd60',
    tier: 2,
    tx_hash: '0xadd5fb39a08cd4c009773f001ceabd91e65c15cd17599f1a4d78938202de6a68',
    amount: 2,
  },
  {
    wallet: '0x3c785af6a41490c24d6910bfa9baffabd1dd2f21',
    tier: 2,
    tx_hash: '0x571f88342d2884c13a128b6a7262d2a82b69390453e7d5143c6ebf6e22273d37',
    amount: 2,
  },
];

const insertSeed = db.prepare(`INSERT OR IGNORE INTO burns (wallet, tier, tx_hash, amount) VALUES (?, ?, ?, ?)`);
for (const b of CONFIRMED_BURNS) {
  const r = insertSeed.run(b.wallet, b.tier, b.tx_hash, b.amount);
  if (r.changes > 0) console.log(`[db] seeded burn: ${b.wallet}`);
}

const getConfig = (key) => db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value;
const setConfig = db.prepare('UPDATE config SET value = ? WHERE key = ?');

const getBurnStatus = () => {
  const burn2Count = parseInt(getConfig('burn2_count') || '0');
  return {
    eventLive:   getConfig('event_live') === 'true',
    burn1Open:   getConfig('burn1_open') === 'true',
    burn2Count,
    burn2Open:   burn2Count < 5,
    totalBurn1:  db.prepare("SELECT COUNT(*) AS c FROM burns WHERE tier = 1").get().c,
    totalBurn2:  db.prepare("SELECT COUNT(*) AS c FROM burns WHERE tier = 2").get().c,
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

const setBurn1Open = (open) => setConfig.run(open ? 'true' : 'false', 'burn1_open');
const setEventLive = (live) => setConfig.run(live ? 'true' : 'false', 'event_live');
const getAllBurns  = () => db.prepare('SELECT * FROM burns ORDER BY created_at ASC').all();
const hasTx       = (txHash) => !!db.prepare('SELECT id FROM burns WHERE tx_hash = ?').get(txHash.toLowerCase());

// ── Slideshow ────────────────────────────────────────────────────────────────
// Replaces the entire slideshow list each time the admin saves a new set.
const replaceSlideshowItems = db.transaction((items) => {
  db.prepare('DELETE FROM slideshow_items').run();
  const insert = db.prepare(
    'INSERT INTO slideshow_items (opensea_url, name, image_url, sort_order) VALUES (?, ?, ?, ?)'
  );
  items.forEach((item, i) => {
    insert.run(item.openseaUrl, item.name || null, item.imageUrl || null, i);
  });
});

const getSlideshowItems = () =>
  db.prepare('SELECT id, opensea_url AS openseaUrl, name, image_url AS imageUrl FROM slideshow_items ORDER BY sort_order ASC').all();

module.exports = {
  db, getBurnStatus, recordBurn, setBurn1Open, setEventLive, getAllBurns, hasTx,
  replaceSlideshowItems, getSlideshowItems,
};
