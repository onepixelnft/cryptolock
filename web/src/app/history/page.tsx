"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Hex } from "viem";
import { NftImage, useNftLabel } from "@/components/NftImage";
import { RequireReady } from "@/components/RequireReady";
import { TokenIcon, WalletIcon } from "@/components/TokenIcon";
import { type LockState, Notice, Skeleton, StatusChip, TxLink } from "@/components/ui";
import { type NftLock, useCollectionName, useNftLocks } from "@/hooks/nft";
import { useActivity, useAssets, useCryptoLocks, useLockAccount } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useChainNow } from "@/lib/chainClock";
import { formatAmount, formatBps, formatShortDate } from "@/lib/format";
import { formatDurationLong, useI18n } from "@/lib/i18n";
import type { TKey } from "@/i18n/en";

type Filter = "all" | "active" | "completed" | "early";
const FILTERS: Array<[Filter, TKey]> = [
  ["all", "history.filter.all"],
  ["active", "history.filter.active"],
  ["completed", "history.filter.completed"],
  ["early", "history.filter.early"],
];

interface Row {
  key: string;
  kind: "crypto" | "nft" | "wallet";
  nft?: NftLock;
  href: string;
  symbol: string;
  name: string;
  initial: string;
  start: number;
  end: number;
  staking: boolean;
  rewards: string;
  fees: string;
  category: Exclude<Filter, "all">;
  state: LockState;
  tx?: Hex;
}

export default function HistoryPage() {
  return (
    <div className="container page">
      <RequireReady>
        <History />
      </RequireReady>
    </div>
  );
}

function History() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const now = useChainNow();
  const { address, deployment, chainId } = useNetwork();
  const locks = useCryptoLocks(address);
  const nftLocks = useNftLocks(address);
  const account = useLockAccount(address);
  const activity = useActivity(address, account.data?.deployed ? account.data.address : undefined);
  const { resolve } = useAssets();
  const [filter, setFilter] = useState<Filter>("all");
  const native = deployment!.native;

  const rows: Row[] = [];
  for (const lock of nftLocks.data ?? []) {
    const active = lock.status === "active";
    rows.push({
      key: `n${lock.id}`,
      kind: "nft",
      nft: lock,
      href: `/nft-locks/${lock.id}`,
      symbol: "",
      name: `${t("type.nft")} #${lock.id}`,
      initial: lock.standard === "erc1155" ? t("history.nftUnits", { n: lock.amount.toString() }) : t("history.oneNft"),
      start: lock.start,
      end: lock.end,
      staking: false,
      rewards: t("common.none"),
      fees: lock.feePaid > 0n ? `${formatAmount(lock.feePaid, native.decimals, locale, 6)} ${native.symbol}` : t("common.none"),
      category: active ? "active" : lock.status === "withdrawn" ? "completed" : "early",
      state: active ? (lock.end <= now ? "unlockable" : "active") : lock.status === "withdrawn" ? "completed" : "early",
      tx: activity.data?.nftCreated[lock.id.toString()],
    });
  }
  for (const lock of locks.data ?? []) {
    const asset = resolve(lock.token);
    const fmt = (v: bigint) => `${formatAmount(v, asset.decimals, locale)} ${asset.symbol}`;
    const active = lock.status === "active";
    let rewards = t("common.none");
    if (lock.status === "shares") {
      rewards = t("detail.rewardsInShares");
    } else if (lock.vault) {
      const delta = (active ? lock.currentValue : lock.amountOut + lock.fee) - lock.amount;
      rewards = `${delta >= 0n ? "+" : ""}${fmt(delta)}`;
    }
    rows.push({
      key: `c${lock.id}`,
      kind: "crypto",
      href: `/locks/${lock.id}`,
      symbol: asset.symbol,
      name: `${asset.name} · #${lock.id}`,
      initial: fmt(lock.amount),
      start: lock.start,
      end: lock.end,
      staking: !!lock.vault,
      rewards,
      fees: lock.fee > 0n ? fmt(lock.fee) : t("common.none"),
      category: active ? "active" : lock.status === "early" ? "early" : "completed",
      state: active ? (lock.end <= now ? "unlockable" : "active") : lock.status === "early" ? "early" : "completed",
      tx: activity.data?.cryptoCreated[lock.id.toString()],
    });
  }

  if (account.data?.deployed) {
    for (const lock of account.data.locks) {
      const isActive = lock.status === "active" && lock.end > now;
      const isEarly = lock.status === "early";
      const fees = activity.data?.walletFees[String(lock.index)];
      rows.push({
        key: `w${lock.index}`,
        kind: "wallet",
        href: "/wallet",
        symbol: "",
        name: `${t("common.lockAccount")} · #${lock.index + 1}`,
        initial: t("common.allAssets"),
        start: lock.start,
        end: lock.end,
        staking: lock.staked,
        rewards: t("common.none"),
        fees: isEarly
          ? fees && fees.length > 0
            ? fees
                .map(({ asset: a, amount }) => {
                  const asset = resolve(a);
                  return `${formatAmount(amount, asset.decimals, locale)} ${asset.symbol}`;
                })
                .join(", ")
            : t("history.walletFee", { rate: formatBps(lock.feeBpsPaid, locale) })
          : t("common.none"),
        category: isActive ? "active" : isEarly ? "early" : "completed",
        state: isActive ? "active" : isEarly ? "early" : "completed",
        tx: activity.data?.walletLocked[String(lock.index)],
      });
    }
  }

  rows.sort((a, b) => b.start - a.start);
  const visible = rows.filter((r) => filter === "all" || r.category === filter);
  const loading = locks.isLoading || account.isLoading || nftLocks.isLoading;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="h2">{t("history.title")}</h1>
          <p className="lead muted">{t("history.lead")}</p>
        </div>
        <div className="segmented" role="group" aria-label={t("history.title")}>
          {FILTERS.map(([value, key]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      {activity.data && !activity.data.available && (
        <div className="section">
          <Notice>{t("history.eventsUnavailable")}</Notice>
        </div>
      )}

      {loading ? (
        <div className="stack-16" style={{ paddingTop: 24 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="muted">{t("history.empty")}</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("table.asset")}</th>
              <th>{t("table.initialAmount")}</th>
              <th>{t("table.duration")}</th>
              <th>{t("table.start")}</th>
              <th>{t("table.end")}</th>
              <th>{t("table.staking")}</th>
              <th>{t("table.rewards")}</th>
              <th>{t("table.fees")}</th>
              <th>{t("table.finalStatus")}</th>
              <th>{t("table.tx")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.key}
                className="row-link"
                tabIndex={0}
                onClick={() => router.push(row.href)}
                onKeyDown={(e) => e.key === "Enter" && router.push(row.href)}
              >
                <td className="cell-primary">
                  <span className="asset-cell">
                    {row.kind === "wallet" ? (
                      <WalletIcon size={24} />
                    ) : row.kind === "nft" && row.nft ? (
                      <NftImage nft={row.nft} size={24} />
                    ) : (
                      <TokenIcon symbol={row.symbol} size={24} />
                    )}
                    <span>
                      <strong>{row.kind === "nft" && row.nft ? <NftName lock={row.nft} /> : row.name}</strong>
                      <span className="asset-sub">
                        {row.kind === "wallet" ? t("type.wallet") : row.kind === "nft" ? `${t("type.nft")} · #${row.nft?.id}` : t("type.crypto")}
                      </span>
                    </span>
                  </span>
                </td>
                <td data-label={t("table.initialAmount")} className="num">
                  {row.initial}
                </td>
                <td data-label={t("table.duration")}>{formatDurationLong(row.end - row.start, t)}</td>
                <td data-label={t("table.start")} className="num">
                  {formatShortDate(row.start, locale)}
                </td>
                <td data-label={t("table.end")} className="num">
                  {formatShortDate(row.end, locale)}
                </td>
                <td data-label={t("table.staking")}>{row.staking ? t("common.yes") : t("common.no")}</td>
                <td data-label={t("table.rewards")} className="num">
                  {row.rewards}
                </td>
                <td data-label={t("table.fees")} className="num">
                  {row.fees}
                </td>
                <td data-label={t("table.finalStatus")}>
                  <StatusChip state={row.state} />
                </td>
                <td data-label={t("table.tx")} onClick={(e) => e.stopPropagation()}>
                  {row.tx ? <TxLink hash={row.tx} chainId={chainId} /> : t("common.none")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function NftName({ lock }: { lock: NftLock }) {
  const collectionName = useCollectionName(lock.collection).data ?? "";
  return <>{useNftLabel(lock, collectionName)}</>;
}
