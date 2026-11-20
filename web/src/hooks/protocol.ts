"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { type Address, type Hex, type PublicClient, erc20Abi, formatUnits, pad, parseEventLogs, zeroAddress } from "viem";
import {
  chainlinkAggregatorAbi,
  erc4626Abi,
  lockVaultAbi,
  lockableAccountAbi,
  lockableAccountFactoryAbi,
  nftLockVaultAbi,
  protocolConfigAbi,
} from "@/generated/abis";
import { LOCAL_CHAIN_ID } from "@/config/chains";
import { assetKey, assetsOf, type Asset, NATIVE, isNativeMirror, unknownAsset } from "@/lib/assets";
import { useCustomTokens } from "@/lib/customTokens";
import { toFloat } from "@/lib/format";
import { fetchActivity } from "@/lib/indexer";
import { scanLogs } from "@/lib/logScan";
import { usePreferences } from "@/lib/preferences";
import { type DetectionResult, detectHeldTokens } from "@/lib/tokenDetection";
import { useNetwork } from "./useNetwork";

const REFRESH_MS = 15_000;
const MAX_PRICE_AGE_SECONDS = 2 * 86_400;

export type CryptoLockStatus = "active" | "withdrawn" | "early" | "shares";

export interface CryptoLock {
  id: bigint;
  owner: Address;
  token: Address;
  start: number;
  end: number;
  minFeeBps: number;
  maxFeeBps: number;
  status: CryptoLockStatus;
  vault: Address | null;
  closedAt: number;
  amount: bigint;
  shares: bigint;
  fee: bigint;
  amountOut: bigint;
  currentValue: bigint;
}

export type WalletLockStatus = "active" | "early" | "completed";

export interface WalletLockRecord {
  index: number;
  start: number;
  end: number;
  closedAt: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeBpsPaid: number;
  feeAssetListVersion: number;
  staked: boolean;
  status: WalletLockStatus;
}

export interface TrackedApproval {
  token: Address;
  kind: number;
  spender: Address;
  id: bigint;
  live: boolean;
}

export interface EarlyUnlockPreview {
  feeBps: number;
  assets: readonly Address[];
  balances: readonly bigint[];
  fees: readonly bigint[];
  block: bigint;
  at: number;
}

export interface LockAccountState {
  address: Address;
  deployed: boolean;
  owner: Address | null;
  isLocked: boolean;
  lockedUntil: number;
  locks: WalletLockRecord[];
  approvals: TrackedApproval[];
  recovery: { address: Address | null; delay: number; pendingOwner: Address | null; executableAt: number };
  preview: EarlyUnlockPreview | null;
}

export interface Terms {
  minFeeBps: number;
  maxFeeBps: number;
  minDuration: number;
  maxDuration: number;
  feeAssetListVersion: bigint;
  feeAssets: readonly Address[];
  treasury: Address;
  stakingVaults: Record<string, Address>;
}

export interface Market {
  prices: Record<string, number>;
  shareRates: Record<string, number>;
}

const CRYPTO_STATUS: Record<number, CryptoLockStatus> = { 1: "active", 2: "withdrawn", 3: "early", 4: "shares" };
const WALLET_STATUS: Record<number, WalletLockStatus> = { 1: "active", 2: "early", 3: "completed" };

function nullIfZero(address: Address): Address | null {
  return address === zeroAddress ? null : address;
}

export function useReadyClient() {
  const network = useNetwork();
  const client = usePublicClient();
  const ready = network.status === "ready" && !!client && client.chain.id === network.chainId;
  return { ...network, client, ready };
}

export function useTerms() {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["terms", deployment?.chainId],
    enabled: ready && !!deployment,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Terms> => {
      const address = deployment!.contracts.protocolConfig;
      const read = <T,>(functionName: string) =>
        client!.readContract({ address, abi: protocolConfigAbi, functionName: functionName as never }) as Promise<T>;
      const [fees, minDuration, maxDuration, version, treasury] = await Promise.all([
        read<readonly [number, number]>("earlyUnlockFeeTerms"),
        read<bigint>("minLockDuration"),
        read<bigint>("maxLockDuration"),
        read<bigint>("currentFeeAssetListVersion"),
        read<Address>("treasury"),
      ]);
      const feeAssets = await client!.readContract({ address, abi: protocolConfigAbi, functionName: "feeAssets", args: [version] });

      const candidates = assetsOf(deployment!).filter((a) => a.kind !== "vault");
      const vaults = await Promise.all(
        candidates.map((a) =>
          client!.readContract({ address, abi: protocolConfigAbi, functionName: "stakingVaultOf", args: [a.address] }),
        ),
      );
      const stakingVaults: Record<string, Address> = {};
      candidates.forEach((a, i) => {
        if (vaults[i] !== zeroAddress) stakingVaults[a.key] = vaults[i];
      });

      return {
        minFeeBps: fees[0],
        maxFeeBps: fees[1],
        minDuration: Number(minDuration),
        maxDuration: Number(maxDuration),
        feeAssetListVersion: version,
        feeAssets,
        treasury,
        stakingVaults,
      };
    },
  });
}

export function useMarket() {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["market", deployment?.chainId],
    enabled: ready && !!deployment,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Market> => {
      const assets = assetsOf(deployment!);
      const now = Number((await client!.getBlock()).timestamp);
      const prices: Record<string, number> = {};

      await Promise.all(
        assets
          .filter((a) => a.priceFeed)
          .map(async (a) => {
            try {
              const [round, decimals] = await Promise.all([
                client!.readContract({ address: a.priceFeed!, abi: chainlinkAggregatorAbi, functionName: "latestRoundData" }),
                client!.readContract({ address: a.priceFeed!, abi: chainlinkAggregatorAbi, functionName: "decimals" }),
              ]);
              const answer = round[1];
              const updatedAt = Number(round[3]);
              if (answer > 0n && now - updatedAt <= MAX_PRICE_AGE_SECONDS) {
                prices[a.key] = Number(formatUnits(answer, decimals));
              }
            } catch {
            }
          }),
      );

      const shareRates: Record<string, number> = {};
      await Promise.all(
        assets
          .filter((a) => a.kind === "vault" && a.underlying)
          .map(async (a) => {
            const underlying = assets.find((u) => u.key === a.underlying!.toLowerCase());
            if (!underlying) return;
            try {
              const perShare = await client!.readContract({
                address: a.address,
                abi: erc4626Abi,
                functionName: "convertToAssets",
                args: [10n ** BigInt(a.decimals)],
              });
              const rate = Number(formatUnits(perShare, underlying.decimals));
              shareRates[a.key] = rate;
              if (prices[underlying.key] !== undefined) prices[a.key] = prices[underlying.key] * rate;
            } catch {
            }
          }),
      );
      return { prices, shareRates };
    },
  });
}

export function usdValue(market: Market | undefined, asset: Asset, amount: bigint): number | undefined {
  const price = market?.prices[asset.key];
  return price === undefined ? undefined : price * toFloat(amount, asset.decimals);
}

export function useBalances(owner: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  const { assets } = useAssets();
  const keys = assets.map((a) => a.key).join(",");
  return useQuery({
    queryKey: ["balances", deployment?.chainId, owner, keys],
    enabled: ready && !!deployment && !!owner,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<Record<string, bigint>> => {
      const values = await Promise.all(
        assets.map((a) =>
          a.kind === "native"
            ? client!.getBalance({ address: owner! })
            : client!
                .readContract({ address: a.address, abi: erc20Abi, functionName: "balanceOf", args: [owner!] })
                .catch(() => 0n),
        ),
      );
      return Object.fromEntries(assets.map((a, i) => [a.key, values[i]]));
    },
  });
}

export interface TokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export async function readTokenMetadata(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  address: Address,
): Promise<TokenMetadata | null> {
  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => ""),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (typeof symbol !== "string" || symbol.length === 0 || symbol.length > 32) return null;
    return { address, symbol, name: name || symbol, decimals: Number(decimals) };
  } catch {
    return null;
  }
}

function useTokenMetadata(addresses: Address[]) {
  const { client, deployment, ready } = useReadyClient();
  const key = addresses.map((a) => a.toLowerCase()).sort().join(",");
  return useQuery({
    queryKey: ["tokenMetadata", deployment?.chainId, key],
    enabled: ready && addresses.length > 0,
    staleTime: Infinity,
    queryFn: async () => (await Promise.all(addresses.map((a) => readTokenMetadata(client!, a)))).filter((m) => m !== null),
  });
}

export function useDetectedTokens(owners: Array<Address | undefined>) {
  const { client, chainId, chain, ready } = useReadyClient();
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const holders = owners.filter((o): o is Address => !!o);
  const queryKey = ["detectedTokens", chainId, holders.map((a) => a.toLowerCase()).join(",")];
  return useQuery({
    queryKey,
    enabled:
      ready && preferences.detectTokens && holders.length > 0 && chainId !== LOCAL_CHAIN_ID && !!chain?.contracts?.multicall3,
    staleTime: 5 * 60_000,
    refetchInterval: (query) => (query.state.data && !query.state.data.complete ? 30_000 : 5 * 60_000),
    queryFn: async (): Promise<DetectionResult> => {
      const result = await detectHeldTokens(client as PublicClient, chainId!, holders);
      if (result.complete) return result;
      const previous = queryClient.getQueryData<DetectionResult>(queryKey);
      const tokens = [...result.tokens];
      for (const t of previous?.tokens ?? []) {
        if (!tokens.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) tokens.push(t);
      }
      return { tokens, complete: false };
    },
  });
}

export function useAssets() {
  const { deployment, chainId, address } = useNetwork();
  const { tokens: custom } = useCustomTokens(chainId);
  const lockTokens = useCryptoLocks(address).data;
  const account = useLockAccount(address).data;
  const detected = useDetectedTokens([address, account?.deployed ? account.address : undefined]).data?.tokens;

  const base = useMemo(() => (deployment ? assetsOf(deployment).map((a) => ({ ...a, source: "list" as const })) : []), [deployment]);
  const customAssets = useMemo<Asset[]>(
    () =>
      custom
        .filter((t) => !base.some((a) => a.key === t.address.toLowerCase()) && !isNativeMirror(t.address))
        .map((t) => ({ key: t.address.toLowerCase(), address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, kind: "token", source: "custom" })),
    [custom, base],
  );
  const unknown = useMemo(() => {
    const known = new Set([...base, ...customAssets].map((a) => a.key));
    const found = new Set<string>();
    for (const lock of lockTokens ?? []) {
      const k = assetKey(lock.token);
      if (k !== "native" && !known.has(k)) found.add(lock.token);
    }
    return [...found] as Address[];
  }, [lockTokens, base, customAssets]);
  const discovered = useTokenMetadata(unknown).data;

  const assets = useMemo<Asset[]>(() => {
    const list: Asset[] = [...base, ...customAssets];
    const add = (tokens: TokenMetadata[] | undefined, source: "discovered" | "detected") => {
      for (const t of tokens ?? []) {
        const key = t.address.toLowerCase();
        if (list.some((a) => a.key === key)) continue;
        list.push({ key, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, kind: "token", source });
      }
    };
    add(discovered, "discovered");
    add(detected, "detected");
    return list;
  }, [base, customAssets, discovered, detected]);

  const resolve = useCallback(
    (tokenAddress: string): Asset => assets.find((a) => a.key === assetKey(tokenAddress)) ?? unknownAsset(tokenAddress as Address),
    [assets],
  );
  return { assets, resolve };
}

type RawLock = {
  owner: Address;
  start: bigint;
  minFeeBps: number;
  maxFeeBps: number;
  token: Address;
  end: bigint;
  status: number;
  vault: Address;
  closedAt: bigint;
  amount: bigint;
  shares: bigint;
  fee: bigint;
  amountOut: bigint;
};

function toCryptoLock(id: bigint, raw: RawLock, currentValue: bigint): CryptoLock | null {
  const status = CRYPTO_STATUS[raw.status];
  if (!status) return null;
  return {
    id,
    owner: raw.owner,
    token: raw.token,
    start: Number(raw.start),
    end: Number(raw.end),
    minFeeBps: raw.minFeeBps,
    maxFeeBps: raw.maxFeeBps,
    status,
    vault: nullIfZero(raw.vault),
    closedAt: Number(raw.closedAt),
    amount: raw.amount,
    shares: raw.shares,
    fee: raw.fee,
    amountOut: raw.amountOut,
    currentValue,
  };
}

export function useCryptoLocks(owner: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["cryptoLocks", deployment?.chainId, owner],
    enabled: ready && !!deployment && !!owner,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<CryptoLock[]> => {
      const address = deployment!.contracts.lockVault;
      const ids = await client!.readContract({ address, abi: lockVaultAbi, functionName: "lockIdsOf", args: [owner!] });
      if (ids.length === 0) return [];
      const raws = (await client!.readContract({
        address,
        abi: lockVaultAbi,
        functionName: "getLocks",
        args: [ids],
      })) as readonly RawLock[];
      const values = await Promise.all(
        raws.map((raw, i) =>
          raw.status !== 1
            ? Promise.resolve(0n)
            : raw.vault === zeroAddress && raw.token === zeroAddress
              ? Promise.resolve(raw.amount)
              : client!.readContract({ address, abi: lockVaultAbi, functionName: "currentValue", args: [ids[i]] }),
        ),
      );
      return raws
        .map((raw, i) => toCryptoLock(ids[i], raw, values[i]))
        .filter((l): l is CryptoLock => l !== null)
        .reverse();
    },
  });
}

export interface CryptoLockDetail {
  lock: CryptoLock;
  preview: { gross: bigint; feeBps: number; fee: bigint; amountOut: bigint; block: bigint; at: number };
}

export function useCryptoLock(id: bigint | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["cryptoLock", deployment?.chainId, id?.toString()],
    enabled: ready && !!deployment && id !== undefined,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<CryptoLockDetail | null> => {
      const address = deployment!.contracts.lockVault;
      const block = await client!.getBlock();
      const blockNumber = block.number;
      const raw = (await client!.readContract({
        address,
        abi: lockVaultAbi,
        functionName: "getLock",
        args: [id!],
        blockNumber,
      })) as RawLock;
      if (raw.status === 0) return null;
      const [value, preview] = await Promise.all([
        client!.readContract({ address, abi: lockVaultAbi, functionName: "currentValue", args: [id!], blockNumber }),
        client!.readContract({ address, abi: lockVaultAbi, functionName: "previewEarlyUnlock", args: [id!], blockNumber }),
      ]);
      const lock = toCryptoLock(id!, raw, value);
      if (!lock) return null;
      return {
        lock,
        preview: {
          gross: preview[0],
          feeBps: Number(preview[1]),
          fee: preview[2],
          amountOut: preview[3],
          block: blockNumber,
          at: Number(block.timestamp),
        },
      };
    },
  });
}

type RawWalletLock = {
  start: bigint;
  end: bigint;
  closedAt: bigint;
  minFeeBps: number;
  maxFeeBps: number;
  feeBpsPaid: number;
  feeAssetListVersion: number;
  staked: boolean;
  status: number;
};

export function useLockAccount(owner: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["lockAccount", deployment?.chainId, owner],
    enabled: ready && !!deployment && !!owner,
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<LockAccountState> => {
      const address = await client!.readContract({
        address: deployment!.contracts.accountFactory,
        abi: lockableAccountFactoryAbi,
        functionName: "predictAddress",
        args: [owner!, 0n],
      });
      const code = await client!.getCode({ address });
      const empty: LockAccountState = {
        address,
        deployed: false,
        owner: null,
        isLocked: false,
        lockedUntil: 0,
        locks: [],
        approvals: [],
        recovery: { address: null, delay: 0, pendingOwner: null, executableAt: 0 },
        preview: null,
      };
      if (!code || code === "0x") return empty;

      const read = <T,>(functionName: string) =>
        client!.readContract({ address, abi: lockableAccountAbi, functionName: functionName as never }) as Promise<T>;
      const [accountOwner, isLocked, lockedUntil, rawLocks, tracked, recoveryAddress, recoveryDelay, pendingOwner, executableAt] =
        await Promise.all([
          read<Address>("owner"),
          read<boolean>("isLocked"),
          read<bigint>("lockedUntil"),
          read<readonly RawWalletLock[]>("getLocks"),
          read<readonly [readonly { token: Address; kind: number; spender: Address; id: bigint }[], readonly boolean[]]>(
            "trackedApprovals",
          ),
          read<Address>("recoveryAddress"),
          read<bigint>("recoveryDelay"),
          read<Address>("pendingRecoveryOwner"),
          read<bigint>("recoveryExecutableAt"),
        ]);

      let preview: EarlyUnlockPreview | null = null;
      if (isLocked) {
        const block = await client!.getBlock();
        const p = await client!.readContract({
          address,
          abi: lockableAccountAbi,
          functionName: "previewEarlyUnlock",
          blockNumber: block.number,
        });
        preview = {
          feeBps: Number(p[0]),
          assets: p[1],
          balances: p[2],
          fees: p[3],
          block: block.number,
          at: Number(block.timestamp),
        };
      }

      return {
        address,
        deployed: true,
        owner: accountOwner,
        isLocked,
        lockedUntil: Number(lockedUntil),
        locks: rawLocks
          .map((l, index) => ({
            index,
            start: Number(l.start),
            end: Number(l.end),
            closedAt: Number(l.closedAt),
            minFeeBps: l.minFeeBps,
            maxFeeBps: l.maxFeeBps,
            feeBpsPaid: l.feeBpsPaid,
            feeAssetListVersion: l.feeAssetListVersion,
            staked: l.staked,
            status: WALLET_STATUS[l.status] ?? "completed",
          }))
          .reverse(),
        approvals: tracked[0].map((a, i) => ({ ...a, live: tracked[1][i] })),
        recovery: {
          address: nullIfZero(recoveryAddress),
          delay: Number(recoveryDelay),
          pendingOwner: nullIfZero(pendingOwner),
          executableAt: Number(executableAt),
        },
        preview,
      };
    },
  });
}

const APY_WINDOW_SECONDS = 7 * 86_400;
const MIN_APY_WINDOW_SECONDS = 86_400;

export interface ApyEstimate {
  apy: number | null;
  windowDays: number;
}

export function useVaultApy(vault: Address | undefined, shareDecimals: number | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["apy", deployment?.chainId, vault],
    enabled: ready && !!vault && shareDecimals !== undefined,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ApyEstimate> => {
      const latest = await client!.getBlock();
      const target = latest.timestamp - BigInt(APY_WINDOW_SECONDS);
      let lo = BigInt(deployment!.deployBlock);
      let hi = latest.number;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        const block = await client!.getBlock({ blockNumber: mid });
        if (block.timestamp < target) lo = mid + 1n;
        else hi = mid;
      }
      const past = await client!.getBlock({ blockNumber: lo });
      const window = Number(latest.timestamp - past.timestamp);
      if (window < MIN_APY_WINDOW_SECONDS) return { apy: null, windowDays: 0 };
      const unit = 10n ** BigInt(shareDecimals!);
      try {
        const [now, then] = await Promise.all([
          client!.readContract({ address: vault!, abi: erc4626Abi, functionName: "convertToAssets", args: [unit] }),
          client!.readContract({ address: vault!, abi: erc4626Abi, functionName: "convertToAssets", args: [unit], blockNumber: past.number }),
        ]);
        if (then === 0n) return { apy: null, windowDays: 0 };
        const growth = Number(now) / Number(then);
        const apy = Math.pow(growth, (365 * 86_400) / window) - 1;
        return { apy: Number.isFinite(apy) ? apy : null, windowDays: Math.round(window / 86_400) };
      } catch {
        return { apy: null, windowDays: 0 };
      }
    },
  });
}

export interface Activity {
  available: boolean;
  cryptoCreated: Record<string, Hex>;
  cryptoClosed: Record<string, Hex>;
  nftCreated: Record<string, Hex>;
  nftClosed: Record<string, Hex>;
  walletLocked: Record<string, Hex>;
  walletClosed: Record<string, Hex>;
  walletFees: Record<string, Array<{ asset: Address; amount: bigint }>>;
}

export function useActivity(owner: Address | undefined, account: Address | undefined) {
  const { client, deployment, ready } = useReadyClient();
  return useQuery({
    queryKey: ["activity", deployment?.chainId, owner, account],
    enabled: ready && !!deployment && !!owner,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Activity> => {
      const activity: Activity = {
        available: true,
        cryptoCreated: {},
        cryptoClosed: {},
        nftCreated: {},
        nftClosed: {},
        walletLocked: {},
        walletClosed: {},
        walletFees: {},
      };

      const indexed = await fetchActivity(deployment!.chainId, owner!);
      if (indexed) {
        for (const e of indexed) {
          const key = e.args.lockId ?? e.args.lockIndex;
          if (key === undefined) continue;
          if (e.eventName === "Locked") activity.cryptoCreated[key] = e.txHash;
          if (e.eventName === "Withdrawn" || e.eventName === "UnlockedEarly" || e.eventName === "SharesWithdrawn") {
            activity.cryptoClosed[key] = e.txHash;
          }
          if (e.eventName === "NftLocked") activity.nftCreated[key] = e.txHash;
          if (e.eventName === "NftWithdrawn" || e.eventName === "NftUnlockedEarly") activity.nftClosed[key] = e.txHash;
          if (e.eventName === "WalletLocked") activity.walletLocked[key] = e.txHash;
          if (e.eventName === "WalletUnlockedEarly" || e.eventName === "WalletLockCompleted") activity.walletClosed[key] = e.txHash;
          if (e.eventName === "EarlyUnlockFeePaid") {
            (activity.walletFees[key] ??= []).push({ asset: e.args.asset as Address, amount: BigInt(e.args.amount ?? "0") });
          }
        }
        return activity;
      }

      try {
        const d = deployment!;
        const fromBlock = BigInt(d.deployBlock);
        const scope = `${d.chainId}:${d.deployedAt}:${d.deployBlock}`;
        const lockVault = d.contracts.lockVault.toLowerCase();
        const nftVault = d.contracts.nftLockVault?.toLowerCase();

        const ownerLogs = await scanLogs(client!, {
          key: `${scope}:owner:${owner!.toLowerCase()}`,
          address: [d.contracts.lockVault, ...(d.contracts.nftLockVault ? [d.contracts.nftLockVault] : [])],
          topics: [null, null, pad(owner!.toLowerCase() as Hex)],
          fromBlock,
        });
        const cryptoLogs = parseEventLogs({ abi: lockVaultAbi, logs: ownerLogs.filter((l) => l.address.toLowerCase() === lockVault) });
        for (const log of cryptoLogs) {
          if (log.eventName === "Locked") activity.cryptoCreated[String(log.args.lockId)] = log.transactionHash!;
          if (log.eventName === "Withdrawn" || log.eventName === "UnlockedEarly" || log.eventName === "SharesWithdrawn") {
            activity.cryptoClosed[String(log.args.lockId)] = log.transactionHash!;
          }
        }
        if (nftVault) {
          const nftLogs = parseEventLogs({ abi: nftLockVaultAbi, logs: ownerLogs.filter((l) => l.address.toLowerCase() === nftVault) });
          for (const log of nftLogs) {
            if (log.eventName === "NftLocked") activity.nftCreated[String(log.args.lockId)] = log.transactionHash!;
            if (log.eventName === "NftWithdrawn" || log.eventName === "NftUnlockedEarly") {
              activity.nftClosed[String(log.args.lockId)] = log.transactionHash!;
            }
          }
        }

        if (account) {
          const raw = await scanLogs(client!, { key: `${scope}:account:${account.toLowerCase()}`, address: account, fromBlock });
          for (const log of parseEventLogs({ abi: lockableAccountAbi, logs: raw })) {
            if (log.eventName === "WalletLocked") activity.walletLocked[String(log.args.lockIndex)] = log.transactionHash!;
            if (log.eventName === "WalletUnlockedEarly" || log.eventName === "WalletLockCompleted") {
              activity.walletClosed[String(log.args.lockIndex)] = log.transactionHash!;
            }
            if (log.eventName === "EarlyUnlockFeePaid") {
              const key = String(log.args.lockIndex);
              (activity.walletFees[key] ??= []).push({ asset: log.args.asset, amount: log.args.amount });
            }
          }
        }
      } catch {
        activity.available = false;
      }
      return activity;
    },
  });
}

export { NATIVE };
