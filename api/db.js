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

  INSERT OR IGNORE INTO config (key, value) VALUES ('burn1_open',  'true');
  INSERT OR IGNORE INTO config (key, value) VALUES ('burn2_count', '0');
`);

const getConfig = (key) =>
  db.prepare('SELECT value FROM config WHERE key = ?').get(key)?.value;

const setConfig = db.prepare('UPDATE config SET value = ? WHERE key = ?');

const getBurnStatus = () => {
  const burn2Count = parseInt(getConfig('burn2_count') || '0');
  return {
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

const getAllBurns = () =>
  db.prepare('SELECT * FROM burns ORDER BY created_at ASC').all();

const hasTx = (txHash) =>
  !!db.prepare('SELECT id FROM burns WHERE tx_hash = ?').get(txHash.toLowerCase());

module.exports = { getBurnStatus, recordBurn, setBurn1Open, getAllBurns, hasTx };
