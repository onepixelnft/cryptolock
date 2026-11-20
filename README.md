<p align="center">
  <img src="brand/cryptolock-wordmark.png" alt="CryptoLock" width="420">
</p>

# CryptoLock — v1.0.0

CryptoLock locks a cryptocurrency (**Crypto Lock**), an NFT (**NFT Lock**) or a whole wallet
(**Wallet Lock**) for a chosen period, on-chain, with optional staking and a transparent, paid early
unlock. **Main network: Polygon** (testnet: Polygon Amoy); about 90 EVM networks are supported.
**Every ERC-20 token can be locked**, with no allow-list, including tokens whose balance changes on
its own (rebasing, reflection, fee-on-transfer).

| Folder | Content |
| --- | --- |
| `contracts/` | Solidity 0.8.28 (Hardhat): `ProtocolConfig`, `LockVault`, `NftLockVault`, `LockableAccount`, `LockableAccountFactory`, ~90 network configs, deployment scripts (one network or all, free rehearsal), 72 tests |
| `web/` | Next.js 15 + wagmi 2 + viem: dashboard, 5-step creation, automatic token detection, lock details, Wallet Lock, history, settings, docs (English, French available) |
| `indexer/` | Node 24 + SQLite (`node:sqlite`): event indexing, history API, wallet-signed preferences, 12 tests |
| `e2e/` | End-to-end test of the real interface (headless Chrome + local node), 18 scenarios |
| `brand/` | Logo files (SVG and PNG) |

---

## Quick start

Requirements: Node.js ≥ 22.13 (tested with Node 24); Google Chrome for the end-to-end test; Git to
publish on GitHub.

Double-click **`lancer-polygon.bat`** to launch CryptoLock on Polygon, or **`lancer.bat`** for the
full menu:

| Option | Action |
| --- | --- |
| **1** | **Launch the website on Polygon** (production); deploys the contracts first if needed |
| 2 | Free rehearsal of the Polygon deployment on a local copy of Polygon (real tokens and prices, nothing sent, real cost shown) |
| 3 / 4 | Deploy on Polygon Amoy (free testnet) / on Polygon (real coins, type `YES` to confirm) |
| 5 | Start everything locally: blockchain, contracts and test assets, indexer, website |
| 6 / 7 | Open the website / stop everything |
| 8 / 9 | Move the local blockchain time forward / simulate yield on the test vaults |
| 10 / 11 | All tests / end-to-end test in Chrome |
| 12 / 13 | List the 90 networks and their state / deploy on another network |
| 14 / 15 / 16 | Deploy on every testnet / every mainnet / every network |
| 17 | Free rehearsal on a local copy of another network |
| 18 / 19 / 20 | Install dependencies / export ABIs / production build for Polygon |
| 21 | **Publish the project on GitHub** |

Shortcuts: `lancer.bat polygon`, `lancer.bat local`, `lancer.bat github`, or `lancer.bat <number>`.
Dependencies are installed automatically on first use.

### Launching on Polygon (option 1)

1. If CryptoLock is not deployed on Polygon (or is an old version), the script offers to deploy:
   it shows a plan (deployment account balance, estimated cost), asks for `YES`, deploys (about
   1.5 to 3 POL of gas), then launches the website.
2. The website is built in production mode: the local network disappears, and a wallet connected to
   another network is asked to switch to Polygon.
3. The indexer follows Polygon (public RPC by default, 16 confirmations).
4. The website opens on http://localhost:3000. Option 7 stops everything.

### Publishing on GitHub (option 21)

1. Install Git: `winget install --id Git.Git -e`.
2. Create an **empty** repository on https://github.com/new (private recommended).
3. Option 21: the script initialises Git, asks for your name/email the first time, asks for the
   repository URL, checks that **no secret file** (`.env`, `.env.local`, keys, `cle-api.txt`) is
   included, asks for confirmation, then commits and pushes. Sign in to GitHub in the window that
   opens. Run it again later to publish updates.

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

The user picks a token (or the native coin), an amount, a duration and optional staking. Tokens are
held by `LockVault` until the unlock date: **Unlock at Maturity** returns everything; **Unlock
Early** returns the amount minus the early-unlock fee. Nobody, including the administrator, can move
locked funds; pausing only blocks new locks.

- **Every token**: the non-staked locks of a token share a pool; each lock owns pool shares. Rebasing
  and reflection tokens (stETH, Aave aTokens…) credit every lock pro rata, fee-on-transfer tokens are
  recorded as received, ordinary tokens are returned to the unit. Virtual shares make donation
  ("inflation") attacks unprofitable.
- **Native coin mirrors** (POL `0x…1010` on Polygon, CELO, Moonbeam precompiles) are refused as
  tokens: the native coin is locked directly.
- **Terms bound to the transaction**: the lock transaction carries the reviewed staking vault and
  fee range; if the administrator changed them, it reverts and the app shows the new terms.
- **Blocked staking vault**: if the vault cannot redeem at maturity, `withdrawShares` hands the vault
  shares to the owner, free of charge.
- **Token detection**: the website downloads public token lists (CoinGecko, Uniswap, Superchain) at
  most once a day, then reads balances on-chain through Multicall3. Your address is never sent to
  these lists. Any other token can be added by contract address.

### NFT Lock — `NftLockVault`

Locks an ERC-721 or ERC-1155 amount. The early-unlock fee is paid in the native coin and decreases
linearly from a maximum to a minimum, both copied into the lock.

### Wallet Lock — the Lock Account

A private-key wallet can always sign, so CryptoLock never claims to freeze one. A Wallet Lock applies
to a **Lock Account**: a minimal smart account owned by your wallet. While locked, it refuses every
outgoing call, every signature (ERC-1271 disabled) and every ownership change; a lock cannot start
while an approval granted by the account is live.

### Early-unlock fee

```
rate = min + (max − min) × remaining time ÷ total duration        (default: 1% → 5%)
```

Terms are copied into each lock; a hard cap of 20% is written in the code. The app shows the figures
computed by the contract (`previewEarlyUnlock`).

---

## Networks and deployment

Polygon is listed first everywhere, with 34 default tokens (25 with a Chainlink price), all verified
on-chain at deployment. Production contracts target the EVM `paris` version, so they run on every
EVM network (zkSync-based networks are excluded).

1. Copy `contracts/.env.example` to `contracts/.env` and set `DEPLOYER_PRIVATE_KEY` (a dedicated
   deployment wallet), `TREASURY_ADDRESS` and optionally `PROTOCOL_OWNER`.
2. Fund the deployment account on each target network.
3. Use options 1, 3, 4 or 13 to 16: each shows a plan first, then asks for confirmation.

Interrupted deployments resume automatically; a network already running the current contracts is
never redeployed by accident (`FORCE_REDEPLOY=true` to force); upgrading a network keeps its
`ProtocolConfig`; stale `RESUME_*` lines are ignored with a warning.

Command line:

```powershell
cd contracts
npm run networks
$env:DEPLOY_TARGET="polygonAmoy"; npm run deploy:networks          # plan only
$env:DEPLOY_MODE="run"; npm run deploy:networks                    # deploy
$env:FORK_NETWORK="polygon"; npm run deploy:rehearsal              # free rehearsal
```

Configuration: `RPC_URL_<chainId>` (contracts and indexer), `NEXT_PUBLIC_POLYGON_RPC_URL`,
`NEXT_PUBLIC_RPC_URLS`, `NEXT_PUBLIC_TOKEN_LISTS`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (web). See
the `.env.example` files.

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

- **The contracts have not been audited.** Use Polygon Amoy first; get an external audit before
  opening CryptoLock to the public with real funds.
- The `ProtocolConfig` owner should be a multisig behind a timelock; its powers only affect new locks.
- CryptoLock never asks for or stores a recovery phrase or private key. Every transaction is
  simulated before reaching the wallet.
- Website: Content-Security-Policy, HSTS in production, COOP. Indexer: per-IP rate limits, capped
  responses, errors without RPC URLs.
- `.gitignore` excludes every secret file; option 21 refuses to publish if one is staged.

## License

MIT (see the SPDX headers of the contracts).
