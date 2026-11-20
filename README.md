<p align="center">
  <img src="brand/cryptolock-wordmark.png" alt="CryptoLock" width="420">
</p>

# CryptoLock — v1.0.0

CryptoLock locks a cryptocurrency (**Crypto Lock**), an NFT (**NFT Lock**) or a whole wallet
(**Wallet Lock**) for a chosen period, on-chain, **on Polygon**, with optional staking and a
transparent, paid early unlock. **Every ERC-20 token of Polygon can be locked**, with no allow-list,
including tokens whose balance changes on its own (rebasing, reflection, fee-on-transfer).

Source code: https://github.com/onepixelnft/cryptolock

| Folder | Content |
| --- | --- |
| `contracts/` | Solidity 0.8.28 (Hardhat): `ProtocolConfig`, `LockVault`, `NftLockVault`, `LockableAccount`, `LockableAccountFactory`, Polygon configuration, deployment, rehearsal and administration scripts, 72 tests |
| `web/` | Next.js 15 + wagmi 2 + viem: dashboard, 5-step creation, automatic token detection, lock details, Wallet Lock, history, settings, docs (English, French available) |
| `indexer/` | Node 24 + SQLite (`node:sqlite`): event indexing, history API, wallet-signed preferences, 12 tests |
| `e2e/` | End-to-end test of the real interface (headless Chrome + local node), 18 scenarios |
| `brand/` | Logo files (SVG and PNG) |

## Deployed contracts (Polygon)

| Contract | Address |
| --- | --- |
| ProtocolConfig | `0x58f79e6E07F17b06C1b64DB22C8C0F8f8c8381d5` |
| LockVault | `0xEb5c4e27EBdA663761f1a7F2e408c960685702B4` |
| LockableAccountFactory | `0xAC259e176d9F0F17bdA39a553A8f37FE4C8f63D8` |
| NftLockVault | `0xb7d3C1b15F95da5e66A431a1131dD65048a152b0` |

---

## Quick start

Requirements: Node.js ≥ 22.13 (tested with Node 24); Google Chrome for the end-to-end test; Git to
publish on GitHub.

Double-click **`lancer-polygon.bat`** to launch CryptoLock on Polygon, or **`lancer.bat`** for the
full menu:

| Option | Action |
| --- | --- |
| **1** | **Launch the website on Polygon** (production); deploys the contracts first if needed |
| 2 | Free rehearsal of the deployment on a local copy of Polygon (real tokens and prices, nothing sent, real cost shown) |
| 3 | Deploy on Polygon (real coins, type `YES` to confirm) |
| 4 | **Protocol settings**: new owner, new treasury, early-unlock fees, staking vault per token (plan first, then `YES`) |
| 5 | Accept the ownership (step 2, signed by the new owner) |
| 6 / 7 / 8 | Start everything locally / open the website / stop everything |
| 9 / 10 | Move the local blockchain time forward / simulate yield on the test vaults |
| 11 / 12 | All tests / end-to-end test in Chrome |
| 13 / 14 / 15 | Install dependencies / export ABIs / production build for Polygon |
| 16 | **Publish the project on GitHub** |

Shortcuts: `lancer.bat polygon`, `lancer.bat local`, `lancer.bat github`, or `lancer.bat <number>`.
Dependencies are installed automatically on first use. The local development network (Hardhat) is
only used on your computer: it never appears on the production website.

### Hosting the website on Vercel

1. On https://vercel.com/new, sign in with GitHub and import `onepixelnft/cryptolock`.
2. **Root Directory**: `web` (the framework is detected as Next.js).
3. **Environment Variables**: `NEXT_PUBLIC_POLYGON_RPC_URL` = your Alchemy Polygon URL. The other
   production settings come from `web/.env.production`.
4. Deploy. Every later publication (option 16) redeploys the website automatically.
5. Add the Vercel domain to the allowed domains of your Alchemy app and of your WalletConnect
   (Reown) project.

### Publishing on GitHub (option 16)

The script commits and pushes the project after checking that **no secret file** (`.env`,
`.env.local`, keys, `cle-api.txt`) is included. Sign in to GitHub in the window that opens.

### Local development by hand

```powershell
cd contracts; npm install; npm run node          # terminal 1: local blockchain
cd contracts; npm run deploy:local               # terminal 2: contracts + test assets
cd indexer; npm install; npm start               # terminal 3 (optional)
cd web; npm install; copy .env.example .env.local; npm run dev   # terminal 4: http://localhost:3000
```

Wallet: add the `Hardhat` network in MetaMask (RPC `http://127.0.0.1:8545`, chain id `31337`) and
import a development account printed by `npm run node`. These keys are public: never use them on a
real network.

---

## How it works

### Crypto Lock — `LockVault`

The user picks a token (or POL), an amount, a duration and optional staking. Tokens are held by
`LockVault` until the unlock date: **Unlock at Maturity** returns everything; **Unlock Early**
returns the amount minus the early-unlock fee. Nobody, including the administrator, can move locked
funds; pausing only blocks new locks.

- **Every token**: the non-staked locks of a token share a pool; each lock owns pool shares. Rebasing
  and reflection tokens (stETH, Aave aTokens…) credit every lock pro rata, fee-on-transfer tokens are
  recorded as received, ordinary tokens are returned to the unit. Virtual shares make donation
  ("inflation") attacks unprofitable.
- **POL mirror**: the ERC-20 contract mirroring POL (`0x…1010`) is refused as a token; POL is locked
  directly as the native coin.
- **Terms bound to the transaction**: the lock transaction carries the reviewed staking vault and
  fee range; if the administrator changed them, it reverts and the app shows the new terms.
- **Staking vaults**: staking is off until the owner sets an ERC-4626 vault for a token with option 4
  (token address or `POL`, then the vault address, or `NONE` to turn it off). The script checks that
  the vault really holds that token; choose only audited, widely used vaults.
- **Blocked staking vault**: if the vault cannot redeem at maturity, `withdrawShares` hands the vault
  shares to the owner, free of charge.
- **Token detection**: the website downloads the public CoinGecko token list for Polygon at most
  once a day, then reads balances on-chain through Multicall3. Your address is never sent to
  CoinGecko. Any other token can be added by contract address.

### NFT Lock — `NftLockVault`

Locks an ERC-721 or ERC-1155 amount. The early-unlock fee is paid in POL and decreases linearly from
a maximum to a minimum, both copied into the lock.

### Wallet Lock — the Lock Account

A private-key wallet can always sign, so CryptoLock never claims to freeze one. A Wallet Lock applies
to a **Lock Account**: a minimal smart account owned by your wallet. While locked, it refuses every
outgoing call, every signature (ERC-1271 disabled) and every ownership change; a lock cannot start
while an approval granted by the account is live.

### Early-unlock fee

```
rate = min + (max − min) × remaining time ÷ total duration
```

Terms are copied into each lock; a hard cap of 20% is written in the code. The owner can change the
terms for new locks with option 4. The app shows the figures computed by the contract
(`previewEarlyUnlock`).

---

## Deployment and administration

1. Copy `contracts/.env.example` to `contracts/.env` and set `DEPLOYER_PRIVATE_KEY` (a dedicated
   deployment wallet), `TREASURY_ADDRESS`, `RPC_URL_137` (your Alchemy URL) and optionally
   `PROTOCOL_OWNER`.
2. Do the free rehearsal (option 2), then deploy (option 3) and publish (option 16).

Interrupted deployments resume automatically; Polygon is never redeployed by accident
(`FORCE_REDEPLOY=true` to force); stale `RESUME_*` lines are ignored with a warning.

**Moving the ownership** (option 4, then option 5): option 4 sets a new treasury and new fees and
starts the ownership transfer, signed by the current owner. The new owner then accepts with option 5
(its key in `contracts/.env`). If the new owner is a Safe multisig, accept from the Safe app instead:
Transaction Builder → contract `0x58f79e6E07F17b06C1b64DB22C8C0F8f8c8381d5` → `acceptOwnership()`.

Command line:

```powershell
cd contracts
$env:FORK_NETWORK="polygon"; npm run deploy:rehearsal              # free rehearsal
$env:DEPLOY_TARGET="polygon"; npm run deploy:networks              # plan only
$env:ADMIN_NEW_OWNER="0x..."; npm run admin                        # plan of the changes
```

---

## Tests

```powershell
cd contracts; npm test            # 72 tests
cd indexer;   npm test            # 12 tests
cd e2e; npm install; npm test     # 18 end-to-end scenarios
```

Also verified on a local copy of Polygon: deployment of the 34 tokens and price feeds, real tokens
locked and withdrawn (DAI, WBTC, WETH, USDC, LINK, USDT0 exact; an Aave aToken earning interest
while locked), and the production website (wallet on Polygon, detection and lock of a token absent
from the protocol list).

---

## Security

- **The contracts have not been audited.** Get an external audit before opening CryptoLock to the
  public with real funds; until then, only lock amounts you can afford to lose.
- The `ProtocolConfig` owner (also administrator of the vaults) should be a Safe multisig whose keys
  were never shared; its powers only affect new locks and the fees. Use option 4 to move it.
- CryptoLock never asks for or stores a recovery phrase or private key. Every transaction is
  simulated before reaching the wallet.
- Website: Content-Security-Policy, HSTS, COOP, X-Frame-Options, no `X-Powered-By`. WalletConnect
  dependencies are pinned to versions without known high-severity vulnerabilities.
- Indexer: per-IP rate limits, capped responses, errors without RPC URLs.
- The Polygon RPC URL is visible in the browser: restrict your Alchemy key to your website domain.
- `.gitignore` excludes every secret file; option 16 refuses to publish if one is staged.

## License

MIT
