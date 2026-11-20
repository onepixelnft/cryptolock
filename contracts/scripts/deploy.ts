import { ethers, network } from "hardhat";
import type { BaseContract, ContractTransactionResponse } from "ethers";
import {
  KNOWN_NATIVE_TOKEN_ALIASES,
  LIVE_NETWORKS,
  type LiveNetworkConfig,
  type TokenConfig,
  type WrappedNativeConfig,
} from "./networks";
import {
  type DeployedNftCollection,
  type DeployedToken,
  type Deployment,
  type PendingDeployment,
  PROTOCOL_VERSION,
  clearPendingDeployment,
  readDeployments,
  readPendingDeployment,
  writeDeployment,
  writePendingDeployment,
} from "./lib/deployment-file";

const MAX_FEE_ASSETS = 32;

const IN_PROCESS_COPY =
  network.name === "hardhat" && !!(network.config as { forking?: { enabled?: boolean; url?: string } }).forking?.url;
const NODE_COPY = network.name === "localhost" && !!process.env.FORK_NETWORK?.trim();
const REHEARSAL = IN_PROCESS_COPY || (NODE_COPY && process.env.FORK_WRITE_DEPLOYMENT !== "true");

const DAY = 86_400;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number (got "${raw}")`);
  return value;
}

function envAddress(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!ethers.isAddress(raw)) throw new Error(`${name} must be a valid address (got "${raw}")`);
  return raw;
}

const MIN_FEE_BPS = envNumber("MIN_EARLY_UNLOCK_FEE_BPS", 100);
const MAX_FEE_BPS = envNumber("MAX_EARLY_UNLOCK_FEE_BPS", 2000);

async function deploy<T extends BaseContract>(name: string, args: unknown[] = []): Promise<T> {
  const contract = await ethers.deployContract(name, args);
  await contract.waitForDeployment();
  console.log(`  ${name.padEnd(24)} ${await contract.getAddress()}`);
  return contract as unknown as T;
}

async function send(tx: Promise<ContractTransactionResponse>) {
  const response = await tx;
  await response.wait();
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId === 31337) return deployLocal();
  if (REHEARSAL) {
    console.log("REHEARSAL on a local copy of the network: nothing is sent to the real network, no file is written.\n");
  } else if (NODE_COPY) {
    console.log("LOCAL COPY of the network: the deployment files will point to the copy. Restore them afterwards.\n");
  }
  if (IN_PROCESS_COPY || NODE_COPY) {
    await network.provider.send("evm_mine", []);
  }
  return deployLive(chainId);
}

async function deployLocal() {
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const treasury = signers[9];
  const deployBlock = (await ethers.provider.getBlockNumber()) + 1;
  console.log("Deploying to the local development network (chain 31337)\n");

  const weth = await deploy("MockWETH");
  const usdc = await deploy("MockERC20", ["USD Coin (test)", "USDC", 6]);
  const dai = await deploy("MockERC20", ["Dai Stablecoin (test)", "DAI", 18]);
  const wbtc = await deploy("MockERC20", ["Wrapped Bitcoin (test)", "WBTC", 8]);
  const unlisted = await deploy("MockERC20", ["Unlisted Token (test)", "TUT", 18]);

  const ethFeed = await deploy("MockPriceFeed", [8, "ETH / USD", 3_000n * 10n ** 8n]);
  const btcFeed = await deploy("MockPriceFeed", [8, "BTC / USD", 60_000n * 10n ** 8n]);
  const usdcFeed = await deploy("MockPriceFeed", [8, "USDC / USD", 10n ** 8n]);
  const daiFeed = await deploy("MockPriceFeed", [8, "DAI / USD", 10n ** 8n]);

  const config = await deploy<any>("ProtocolConfig", [
    admin.address,
    treasury.address,
    await weth.getAddress(),
    MIN_FEE_BPS,
    MAX_FEE_BPS,
    60,
    1825 * DAY,
  ]);
  const lockVault = await deploy("LockVault", [await config.getAddress(), ethers.ZeroAddress]);
  const factory = await deploy("LockableAccountFactory", [await config.getAddress()]);
  const nftLockVault = await deploy("NftLockVault", [
    await config.getAddress(),
    ethers.parseEther("0.001"),
    ethers.parseEther("0.01"),
  ]);

  const sUsdc = await deploy("MockYieldVault", [await usdc.getAddress(), "Staked USDC (local test vault)", "sUSDC"]);
  const sDai = await deploy("MockYieldVault", [await dai.getAddress(), "Staked DAI (local test vault)", "sDAI"]);
  const sWeth = await deploy("MockYieldVault", [await weth.getAddress(), "Staked WETH (local test vault)", "sWETH"]);

  const collectibles = await deploy<any>("MockCollectibles");
  const editions = await deploy<any>("MockEditions");

  console.log("\nConfiguring staking vaults and the fee asset list");
  await send(config.setStakingVault(await usdc.getAddress(), await sUsdc.getAddress()));
  await send(config.setStakingVault(await dai.getAddress(), await sDai.getAddress()));
  await send(config.setStakingVault(await weth.getAddress(), await sWeth.getAddress()));
  await send(config.setStakingVault(ethers.ZeroAddress, await sWeth.getAddress()));
  const feeAssets = await Promise.all([usdc, dai, wbtc, weth, sUsdc, sDai, sWeth].map((c) => c.getAddress()));
  await send(config.publishFeeAssetList(feeAssets));

  console.log("Minting test assets to the first five development accounts");
  for (const [i, signer] of signers.slice(0, 5).entries()) {
    await send((usdc as any).mint(signer.address, 100_000n * 10n ** 6n));
    await send((dai as any).mint(signer.address, 100_000n * 10n ** 18n));
    await send((wbtc as any).mint(signer.address, 2n * 10n ** 8n));
    await send((unlisted as any).mint(signer.address, 1_000n * 10n ** 18n));
    for (let id = i * 3 + 1; id <= i * 3 + 3; id++) await send(collectibles.mint(signer.address, id));
    await send(editions.mint(signer.address, 1, 5));
    await send(editions.mint(signer.address, 2, 3));
  }

  const tokens: DeployedToken[] = [
    { address: await usdc.getAddress(), symbol: "USDC", name: "USD Coin (test)", decimals: 6, priceFeed: await usdcFeed.getAddress(), kind: "token" },
    { address: await dai.getAddress(), symbol: "DAI", name: "Dai Stablecoin (test)", decimals: 18, priceFeed: await daiFeed.getAddress(), kind: "token" },
    { address: await wbtc.getAddress(), symbol: "WBTC", name: "Wrapped Bitcoin (test)", decimals: 8, priceFeed: await btcFeed.getAddress(), kind: "token" },
    { address: await weth.getAddress(), symbol: "WETH", name: "Wrapped Ether (test)", decimals: 18, priceFeed: await ethFeed.getAddress(), kind: "token" },
    { address: await sUsdc.getAddress(), symbol: "sUSDC", name: "Staked USDC (local test vault)", decimals: 6, kind: "vault", underlying: await usdc.getAddress() },
    { address: await sDai.getAddress(), symbol: "sDAI", name: "Staked DAI (local test vault)", decimals: 18, kind: "vault", underlying: await dai.getAddress() },
    { address: await sWeth.getAddress(), symbol: "sWETH", name: "Staked WETH (local test vault)", decimals: 18, kind: "vault", underlying: await weth.getAddress() },
  ];
  const nftCollections: DeployedNftCollection[] = [
    { address: await collectibles.getAddress(), name: "Test Collectibles", symbol: "TCOL", standard: "erc721", enumerable: true },
    { address: await editions.getAddress(), name: "Test Editions", symbol: "TED", standard: "erc1155", ids: [1, 2] },
  ];

  const deployment: Deployment = {
    chainId: 31337,
    name: "Local network",
    protocolVersion: PROTOCOL_VERSION,
    isLocal: true,
    deployBlock,
    deployedAt: new Date().toISOString(),
    contracts: {
      protocolConfig: await config.getAddress(),
      lockVault: await lockVault.getAddress(),
      accountFactory: await factory.getAddress(),
      nftLockVault: await nftLockVault.getAddress(),
    },
    wrappedNative: await weth.getAddress(),
    native: { symbol: "ETH", name: "Ether", decimals: 18, priceFeed: await ethFeed.getAddress() },
    tokens,
    nftCollections,
    devUnlistedTokens: [await unlisted.getAddress()],
  };
  console.log("\nWriting deployment files");
  writeDeployment(deployment);
  console.log(`\nDone. Protocol admin: ${admin.address} · treasury: ${treasury.address}`);
}

const erc20MetadataAbi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const balanceAbi = ["function balanceOf(address) view returns (uint256)"];
const feedAbi = ["function description() view returns (string)", "function decimals() view returns (uint8)"];
const vaultAbi = [
  "function asset() view returns (address)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

function defaultPairs(symbol: string): string[] {
  return [`${symbol.replace(/^W(?=[A-Z]{3,}$)/, "")} / USD`];
}

async function verifiedFeed(address: string | undefined, pairs: string[]): Promise<string | undefined> {
  if (!address) return undefined;
  try {
    const feed = new ethers.Contract(address, feedAbi, ethers.provider);
    const description = String(await feed.description()).toUpperCase().replace(/\s+/g, " ").trim();
    if (pairs.some((pair) => description.startsWith(pair.toUpperCase()))) return address;
    console.warn(`  ! price feed ${address} reports "${description}", expected ${pairs.join(" or ")} — dropped`);
  } catch {
    console.warn(`  ! price feed ${address} could not be read — dropped`);
  }
  return undefined;
}

async function verifiedToken(token: TokenConfig): Promise<DeployedToken | undefined> {
  try {
    const contract = new ethers.Contract(token.address, erc20MetadataAbi, ethers.provider);
    const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
    const accepted = [token.symbol, ...(token.aliases ?? [])].map((s) => s.toUpperCase());
    if (!accepted.includes(String(symbol).toUpperCase()) || Number(decimals) !== token.decimals) {
      console.warn(`  ! ${token.symbol} at ${token.address} reports ${symbol}/${decimals} — dropped`);
      return undefined;
    }
    const priceFeed = await verifiedFeed(token.priceFeed, token.feedPairs ?? defaultPairs(token.symbol));
    console.log(`  ok ${token.symbol}${priceFeed ? " (price feed ok)" : ""}`);
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      priceFeed,
      kind: "token",
    };
  } catch {
    console.warn(`  ! ${token.symbol} at ${token.address} could not be read — dropped`);
    return undefined;
  }
}

async function verifiedWrappedNative(wrapped: WrappedNativeConfig | undefined): Promise<string> {
  if (!wrapped) {
    console.log("  -- no wrapped native coin configured: native staking disabled on this deployment");
    return ethers.ZeroAddress;
  }
  try {
    const contract = new ethers.Contract(wrapped.address, erc20MetadataAbi, ethers.provider);
    const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
    if (wrapped.symbols.some((s) => s.toUpperCase() === String(symbol).toUpperCase()) && Number(decimals) === 18) {
      console.log(`  ok wrapped native ${symbol}`);
      return wrapped.address;
    }
    console.warn(`  ! wrapped native at ${wrapped.address} reports ${symbol}/${decimals} — native staking disabled`);
  } catch {
    console.warn(`  ! wrapped native at ${wrapped.address} could not be read — native staking disabled`);
  }
  return ethers.ZeroAddress;
}

async function nativeTokenAlias(net: LiveNetworkConfig, deployer: string): Promise<string> {
  const blockTag = await ethers.provider.getBlockNumber();
  const native = await ethers.provider.getBalance(deployer, blockTag);
  const mirrors = async (address: string) => {
    if ((await ethers.provider.getCode(address, blockTag)) === "0x") return false;
    try {
      const token = new ethers.Contract(address, balanceAbi, ethers.provider);
      return native > 0n && (await token.balanceOf(deployer, { blockTag })) === native;
    } catch {
      return false;
    }
  };
  if (net.nativeTokenAlias) {
    const verified = await mirrors(net.nativeTokenAlias);
    console.log(`  ok native coin mirror ${net.nativeTokenAlias}${verified ? " (balance matches)" : ""}: locked as the native coin only`);
    return net.nativeTokenAlias;
  }
  for (const candidate of KNOWN_NATIVE_TOKEN_ALIASES) {
    if (await mirrors(candidate)) {
      console.log(`  ok native coin mirror detected at ${candidate}: locked as the native coin only`);
      return candidate;
    }
  }
  return ethers.ZeroAddress;
}

async function firstBlockWithCode(address: string): Promise<number> {
  let lo = 0;
  let hi = await ethers.provider.getBlockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await ethers.provider.getCode(address, mid).catch(() => "0x");
    if (code !== "0x") hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function hasCode(address: string): Promise<boolean> {
  return (await ethers.provider.getCode(address)) !== "0x";
}

function networkList(): string {
  return Object.values(LIVE_NETWORKS)
    .map((n) => n.key)
    .join(", ");
}

interface ResumePlan {
  config?: string;
  vault?: string;
  factory?: string;
  nft?: string;
  deployBlock?: number;
  source: "env" | "pending" | "previous" | "none";
}

async function resumePlan(chainId: number, net: LiveNetworkConfig, deployer: string): Promise<ResumePlan> {
  if (REHEARSAL) return { source: "none" };
  const env = {
    config: envAddress("RESUME_PROTOCOL_CONFIG"),
    vault: envAddress("RESUME_LOCK_VAULT"),
    factory: envAddress("RESUME_ACCOUNT_FACTORY"),
    nft: envAddress("RESUME_NFT_LOCK_VAULT"),
  };
  for (const name of Object.keys(env) as Array<keyof typeof env>) {
    const address = env[name];
    if (address && !(await hasCode(address))) {
      console.warn(`  ! RESUME address ${address} (${name}) has no contract on ${net.chain.name}: ignored (it belongs to another network)`);
      env[name] = undefined;
    }
  }
  const lockContracts = [
    ["vault", "LockVault"],
    ["factory", "LockableAccountFactory"],
    ["nft", "NftLockVault"],
  ] as const;
  for (const [name, contractName] of lockContracts) {
    const address = env[name];
    if (!address) continue;
    const contract: any = await ethers.getContractAt(contractName, address);
    const version = await contract.PROTOCOL_VERSION().catch(() => 1n);
    if (Number(version) !== PROTOCOL_VERSION) {
      console.warn(`  ! RESUME ${contractName} ${address} is version ${version}: ignored, a new one is deployed`);
      env[name] = undefined;
    }
  }
  if (env.config || env.vault || env.factory || env.nft) {
    if (!env.config) {
      throw new Error("RESUME_LOCK_VAULT, RESUME_ACCOUNT_FACTORY and RESUME_NFT_LOCK_VAULT require RESUME_PROTOCOL_CONFIG");
    }
    console.log("\nResuming with the contracts given by RESUME_* in contracts/.env");
    return { ...env, source: "env" };
  }

  const pending = readPendingDeployment(chainId);
  if (pending && pending.deployer.toLowerCase() === deployer.toLowerCase() && pending.protocolVersion === PROTOCOL_VERSION) {
    const keep = async (address?: string) => (address && (await hasCode(address)) ? address : undefined);
    const plan: ResumePlan = {
      config: await keep(pending.protocolConfig),
      vault: await keep(pending.lockVault),
      factory: await keep(pending.accountFactory),
      nft: await keep(pending.nftLockVault),
      deployBlock: pending.deployBlock,
      source: "pending",
    };
    if (plan.config) {
      console.log(`\nResuming the interrupted deployment of ${pending.updatedAt}`);
      return plan;
    }
  }

  const previous = readDeployments()[String(chainId)];
  const previousConfig = previous?.contracts.protocolConfig;
  if (previousConfig && (await hasCode(previousConfig))) {
    try {
      const config = await ethers.getContractAt("ProtocolConfig", previousConfig);
      if (String(await config.owner()).toLowerCase() === deployer.toLowerCase()) {
        console.log(`\nKeeping the ProtocolConfig of the previous deployment (${previousConfig}): treasury and terms unchanged`);
        return { config: previousConfig, source: "previous" };
      }
      console.log(`\nThe previous ProtocolConfig (${previousConfig}) belongs to another owner: a new one is deployed`);
    } catch {
    }
  }
  return { source: "none" };
}

async function deployLive(chainId: number) {
  const net: LiveNetworkConfig | undefined = LIVE_NETWORKS[chainId];
  if (!net) throw new Error(`Chain ${chainId} is not configured in scripts/networks.ts. Configured: ${networkList()}`);
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY in contracts/.env (64 hex characters, with or without 0x).");
  }
  const treasury = envAddress("TREASURY_ADDRESS") ?? (REHEARSAL ? deployer.address : undefined);
  if (!treasury) throw new Error("TREASURY_ADDRESS must be set to a valid address");

  const current = readDeployments()[String(chainId)];
  if (!REHEARSAL && current?.protocolVersion === PROTOCOL_VERSION && process.env.FORCE_REDEPLOY !== "true") {
    throw new Error(
      `${net.chain.name} already runs the current contracts (v${PROTOCOL_VERSION}, LockVault ${current.contracts.lockVault}). ` +
        "Redeploying creates new, empty contracts: existing locks stay on the current ones, but the app would no longer show them. " +
        "To redeploy anyway, set FORCE_REDEPLOY=true.",
    );
  }

  const finalOwner = envAddress("PROTOCOL_OWNER") ?? deployer.address;
  const native = net.chain.nativeCurrency;
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying to ${net.chain.name} (chain ${chainId}) from ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ${native.symbol}\n`);
  if (balance === 0n) {
    throw new Error(`The deployer has no ${native.symbol} on ${net.chain.name} to pay for gas.`);
  }

  console.log("Verifying assets on-chain");
  const wrappedNativeCandidate = await verifiedWrappedNative(net.wrappedNative);
  const tokens: DeployedToken[] = [];
  for (const token of net.tokens) {
    const verified = await verifiedToken(token);
    if (verified) tokens.push(verified);
  }
  const nativeFeed = await verifiedFeed(net.nativePriceFeed, net.nativeFeedPairs ?? defaultPairs(native.symbol));
  const alias = await nativeTokenAlias(net, deployer.address);

  const resume = await resumePlan(chainId, net, deployer.address);
  const progress: PendingDeployment = {
    chainId,
    protocolVersion: PROTOCOL_VERSION,
    deployer: deployer.address,
    deployBlock: Math.min(resume.deployBlock ?? Infinity, (await ethers.provider.getBlockNumber()) + 1),
    updatedAt: new Date().toISOString(),
  };
  const save = (patch: Partial<PendingDeployment>) => {
    Object.assign(progress, patch, { updatedAt: new Date().toISOString() });
    if (!REHEARSAL) writePendingDeployment(progress);
  };

  let config: any;
  if (resume.config) {
    config = await ethers.getContractAt("ProtocolConfig", resume.config);
    if (String(await config.owner()).toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error("The deployer is no longer the owner of ProtocolConfig");
    }
    console.log(`  ProtocolConfig verified (${resume.config})`);
  } else {
    console.log("\nDeploying contracts");
    config = await deploy<any>("ProtocolConfig", [
      deployer.address,
      treasury,
      wrappedNativeCandidate,
      MIN_FEE_BPS,
      MAX_FEE_BPS,
      envNumber("MIN_LOCK_DURATION", net.minLockDuration),
      envNumber("MAX_LOCK_DURATION", net.maxLockDuration),
    ]);
  }
  const configAddress = String(await config.getAddress());
  const wrappedNative: string = await config.wrappedNative();
  save({ protocolConfig: configAddress });

  async function resumed(name: string, envName: string, address: string): Promise<BaseContract> {
    const contract: any = await ethers.getContractAt(name, address);
    if (String(await contract.config()).toLowerCase() !== configAddress.toLowerCase()) {
      throw new Error(`${name} at ${address} is not linked to ProtocolConfig ${configAddress}`);
    }
    const version = await contract.PROTOCOL_VERSION().catch(() => 1n);
    if (Number(version) !== PROTOCOL_VERSION) {
      throw new Error(
        `${name} at ${address} was deployed with an older version of the contracts (v${version}). ` +
          `Remove ${envName} from contracts/.env to deploy a new ${name} (the ProtocolConfig can be kept).`,
      );
    }
    console.log(`  ${name} verified (${address})`);
    return contract;
  }

  if (resume.source === "env") {
    for (const address of [resume.vault, resume.factory, resume.nft]) {
      if (address) progress.deployBlock = Math.min(progress.deployBlock, await firstBlockWithCode(address));
    }
  }

  const lockVault = resume.vault
    ? await resumed("LockVault", "RESUME_LOCK_VAULT", resume.vault)
    : await deploy("LockVault", [configAddress, alias]);
  save({ lockVault: String(await lockVault.getAddress()) });
  const factory = resume.factory
    ? await resumed("LockableAccountFactory", "RESUME_ACCOUNT_FACTORY", resume.factory)
    : await deploy("LockableAccountFactory", [configAddress]);
  save({ accountFactory: String(await factory.getAddress()) });
  let nftLockVault: BaseContract;
  if (resume.nft) {
    nftLockVault = await resumed("NftLockVault", "RESUME_NFT_LOCK_VAULT", resume.nft);
  } else {
    const [minNftFee, maxNftFee] = net.nftEarlyUnlockFee.map((v) => ethers.parseEther(v));
    nftLockVault = await deploy("NftLockVault", [configAddress, minNftFee, maxNftFee]);
  }
  save({ nftLockVault: String(await nftLockVault.getAddress()) });

  const vaultTokens: DeployedToken[] = [];
  for (const [key, vaultAddress] of Object.entries(net.stakingVaults)) {
    const token = key === "native" ? ethers.ZeroAddress : key;
    if (String(await config.stakingVaultOf(token)).toLowerCase() !== vaultAddress.toLowerCase()) {
      await send(config.setStakingVault(token, vaultAddress));
    }
    if (!vaultTokens.some((v) => v.address === vaultAddress)) {
      const vault = new ethers.Contract(vaultAddress, vaultAbi, ethers.provider);
      vaultTokens.push({
        address: vaultAddress,
        symbol: await vault.symbol(),
        name: await vault.name(),
        decimals: Number(await vault.decimals()),
        kind: "vault",
        underlying: await vault.asset(),
      });
    }
  }
  const feeAssets = [
    ...tokens.filter((t) => t.priceFeed),
    ...vaultTokens,
    ...tokens.filter((t) => !t.priceFeed),
  ]
    .map((t) => t.address)
    .filter((a, i, all) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i)
    .slice(0, MAX_FEE_ASSETS);
  if ((await config.currentFeeAssetListVersion()) === 0n) {
    await send(config.publishFeeAssetList(feeAssets));
    console.log(`  fee asset list published (${feeAssets.length} assets)`);
  } else {
    console.log("  fee asset list already published");
  }

  if (finalOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    if (String(await config.pendingOwner()).toLowerCase() !== finalOwner.toLowerCase()) {
      await send(config.transferOwnership(finalOwner));
    }
    console.log(`\nOwnership transfer started to ${finalOwner} — it must call acceptOwnership().`);
  }

  const deployment: Deployment = {
    chainId,
    name: net.chain.name,
    protocolVersion: PROTOCOL_VERSION,
    isLocal: false,
    deployBlock: progress.deployBlock,
    deployedAt: new Date().toISOString(),
    contracts: {
      protocolConfig: configAddress,
      lockVault: String(await lockVault.getAddress()),
      accountFactory: String(await factory.getAddress()),
      nftLockVault: String(await nftLockVault.getAddress()),
    },
    wrappedNative,
    native: { symbol: native.symbol, name: native.name, decimals: native.decimals, priceFeed: nativeFeed },
    tokens: [...tokens, ...vaultTokens],
  };
  if (REHEARSAL) {
    const spent = balance - (await ethers.provider.getBalance(deployer.address));
    console.log(`\nRehearsal complete: ${tokens.length} tokens verified (${tokens.filter((t) => t.priceFeed).length} with a price feed), ${feeAssets.length} fee assets.`);
    console.log(`Cost on the real network at the current gas price: about ${ethers.formatEther(spent)} ${native.symbol}.`);
    console.log("Nothing was sent to the real network and no deployment file was written.");
    return;
  }
  console.log("\nWriting deployment files");
  writeDeployment(deployment);
  clearPendingDeployment(chainId);
  const explorer = net.chain.blockExplorers?.default.url;
  if (explorer) console.log(`\nExplorer: ${explorer}/address/${await lockVault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
