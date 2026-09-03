# burn-reveal

Monorepo: `/burn` (Vercel deploy 1) · `/reveal` (Vercel deploy 2) · `/api` (Railway)

---

## Architecture

```
User → burn site → signs ERC-1155 safeTransferFrom to 0xdead (Base)
                 → tx confirmed on-chain
                 → Railway API verifies tx via viem → records in SQLite
                 → Discord webhook posts notification

Admin → download burns.csv → upload to reveal site
     → roulette rolls assign prizes to wallets
     → export results.csv → distribute page sends NFTs per chain
```

---

## Quick Setup

### 1. Railway API

```bash
cd api
npm install
# Copy and fill .env.example → .env
npm run dev           # local dev
# On Railway: set all env vars, deploy from /api folder
```

**Railway env vars:**
| Key | Value |
|-----|-------|
| `ADMIN_API_KEY` | Any secret string |
| `DISCORD_WEBHOOK_URL` | From Discord channel → Integrations → Webhooks |
| `BASE_RPC_URL` | `https://mainnet.base.org` (or your own RPC) |
| `BURN_SITE_URL` | Your Vercel burn site URL |
| `REVEAL_SITE_URL` | Your Vercel reveal site URL |

> **Persistent storage:** In Railway dashboard, add a Volume mounted at `/data` and set `DB_PATH=/data/burns.db`

### 2. Burn Site (Vercel)

```bash
cd burn
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

**Vercel deploy settings:**
- Root directory: `burn`
- Framework: Next.js

**Vercel env vars:**
| Key | Notes |
|-----|-------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | cloud.walletconnect.com |
| `NEXT_PUBLIC_API_URL` | Railway URL, no trailing slash |
| `API_URL` | Same as above (server-side) |
| `ADMIN_API_KEY` | Same as Railway |
| `NEXT_PUBLIC_ADMIN_WALLETS` | `0xWallet1,0xWallet2` |

### 3. Reveal Site (Vercel)

```bash
cd reveal
npm install
cp .env.example .env.local
npm run dev -p 3001
```

**Vercel deploy settings:**
- Root directory: `reveal`

**Vercel env vars:**
| Key | Notes |
|-----|-------|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Same as burn site |
| `NEXT_PUBLIC_ADMIN_WALLETS` | Same admin wallets |

---

## Token

- **Contract:** `0x04619852f38ebec22bb94ef36b99351db9900194`
- **Token ID:** `3`
- **Chain:** Base (ERC-1155)
- **Burn address:** `0x000000000000000000000000000000000000dEaD`

---

## Event Flow

### Burn phase
1. User connects wallet on burn site (Base network)
2. Clicks **BURN ×1** or **BURN ×2** (×2 disappears after 5 burns)
3. Wallet popup → signs `safeTransferFrom(user, 0xdead, 3, amount, 0x)`
4. Frontend waits for Base confirmation → calls Railway API with tx hash
5. Railway API:
   - Verifies `TransferSingle` event on-chain
   - Records wallet + tier in SQLite
   - Posts Discord notification
6. Admin can close Burn ×1 at any time via `/admin` page

### Reveal phase
1. Admin downloads `burns.csv` from burn site admin panel
2. Uploads CSV to reveal site `/roulette`
3. Adds prize images + contract details to prize pool
4. Selects tier (1 or 2), clicks **ROLL** → CS:GO roulette spins
5. Winner wallet + prize displayed
6. Repeat for all burners
7. Export `results.csv`

### Distribution phase
1. Go to `/distribute` on reveal site
2. Results auto-loaded from localStorage (or import results.csv)
3. Connect the wallet that holds the NFTs
4. Switch chain as needed (Ethereum for ×2 prizes, Abstract for GlowBuds, etc.)
5. Click **SEND** per row → wallet popup → sign → NFT sent

---

## Admin commands (burn site `/admin`)

- **OPEN / CLOSE BURN 1** — toggles burn ×1 availability
- **EXPORT CSV** — downloads all burn records
- Burn ×2 closes automatically at 5 burns (no manual action needed)

---

## Discord webhook

Get webhook URL from Discord:
> Channel Settings → Integrations → Webhooks → New Webhook → Copy URL

Paste into Railway `DISCORD_WEBHOOK_URL`.

Posts on every confirmed burn:
- `🔥 BURN ×1 — 0xABCD…EF12 burned 1 token 🔗 BaseScan`
- `🔥 BURN ×2 — 0xABCD…EF12 burned 2 tokens! 📦 Burn-2 slots left: 3/5 🔗 BaseScan`

---

## Two Vercel deploys from one repo

In Vercel dashboard when importing:
1. Select repo
2. **Root Directory:** set to `burn` for deploy 1
3. Import again → **Root Directory:** `reveal` for deploy 2
