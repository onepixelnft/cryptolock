"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { zeroAddress } from "viem";
import { erc4626Abi, lockVaultAbi } from "@/generated/abis";
import { EarlyUnlockModal } from "@/components/EarlyUnlockModal";
import { IconArrowLeft } from "@/components/Icons";
import { RequireReady } from "@/components/RequireReady";
import { TokenIcon } from "@/components/TokenIcon";
import { AddressLink, Countdown, DetailRow, type LockState, Notice, Skeleton, StatusChip, TxProgress } from "@/components/ui";
import { type CryptoLock, useAssets, useCryptoLock, useMarket, useReadyClient, usdValue } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useChainNow } from "@/lib/chainClock";
import { feeBpsAt } from "@/lib/fees";
import { formatAmount, formatBps, formatDate, formatUsd } from "@/lib/format";
import { formatDurationLong, formatDurationShort, useI18n } from "@/lib/i18n";

export default function LockDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="container page">
      <RequireReady>
        <LockDetail idParam={params.id} />
      </RequireReady>
    </div>
  );
}

function LockDetail({ idParam }: { idParam: string }) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, deployment, chain, chainId } = useNetwork();
  const id = /^\d+$/.test(idParam) ? BigInt(idParam) : undefined;
  const query = useCryptoLock(id);
  const market = useMarket().data;
  const { resolve } = useAssets();
  const flow = useTxFlow();
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyDone, setEarlyDone] = useState(false);

  const back = (
    <Link href="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
      <IconArrowLeft /> {t("nav.dashboard")}
    </Link>
  );

  if (query.isLoading) {
    return (
      <div className="stack-16">
        {back}
        <Skeleton width="50%" height={40} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="gate">
        {back}
        <h1 className="h2">{t("detail.notFound")}</h1>
      </div>
    );
  }

  const detail = query.data;
  const { lock } = detail;
  const asset = resolve(lock.token);
  const shareToken = lock.vault ? resolve(lock.vault) : undefined;
  const isOwner = !!address && address.toLowerCase() === lock.owner.toLowerCase();
  const matured = now >= lock.end;
  const active = lock.status === "active";
  const asShares = lock.status === "shares";
  const state: LockState =
    lock.status === "early" ? "early" : !active ? "completed" : matured ? "unlockable" : "active";
  const fmt = (v: bigint) => `${formatAmount(v, asset.decimals, locale)} ${asset.symbol}`;
  const fmtShares = (v: bigint) =>
    `${formatAmount(v, shareToken?.decimals ?? asset.decimals, locale)} ${shareToken?.symbol ?? t("detail.vaultShares")}`;
  const shownValue = active ? lock.currentValue : lock.amountOut;
  const usd = asShares ? undefined : usdValue(market, asset, shownValue);
  const rewards = lock.vault && !asShares ? (active ? lock.currentValue : lock.amountOut + lock.fee) - lock.amount : null;
  const balanceChange =
    !lock.vault && lock.token !== zeroAddress ? (active ? lock.currentValue : lock.amountOut + lock.fee) - lock.amount : 0n;
  const currentFee = active && !matured ? feeBpsAt(lock.minFeeBps, lock.maxFeeBps, lock.start, lock.end, now) : 0;

  const withdraw = () =>
    flow.run([
      {
        id: "withdraw",
        label: t("detail.unlockAtMaturity"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: deployment!.contracts.lockVault,
            abi: lockVaultAbi,
            functionName: "withdraw",
            args: [lock.id],
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);

  return (
    <>
      {back}
      <div className="detail-head">
        <div>
          <div className="eyebrow">{t("detail.cryptoTitle", { id: lock.id.toString() })}</div>
          <div className="detail-amount">
            <TokenIcon symbol={asset.symbol} size={44} />
            <div>
              <div className="h1 num" style={{ fontSize: "clamp(32px, 6vw, 56px)" }}>
                {asShares ? (
                  <>
                    {formatAmount(lock.shares, shareToken?.decimals ?? asset.decimals, locale)}{" "}
                    <span className="muted">{shareToken?.symbol ?? t("detail.vaultShares")}</span>
                  </>
                ) : (
                  <>
                    {formatAmount(shownValue, asset.decimals, locale)} <span className="muted">{asset.symbol}</span>
                  </>
                )}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {asset.name}
                {usd !== undefined && ` · ${formatUsd(usd, locale)}`}
              </div>
            </div>
          </div>
        </div>
        <StatusChip state={state} />
      </div>

      {!isOwner && (
        <div style={{ marginBottom: 24 }}>
          <Notice>{t("detail.notYours")}</Notice>
        </div>
      )}

      {active && !matured && <Countdown target={lock.end} now={now} />}
      {active && matured && <Notice tone="solid">{t("detail.matured")}</Notice>}
      {!active && (
        <Notice>
          {lock.status === "withdrawn"
            ? t("detail.withdrawn")
            : asShares
              ? t("detail.withdrawnShares")
              : t("detail.closed")}
        </Notice>
      )}
      {earlyDone && (
        <div style={{ marginTop: 16 }}>
          <Notice tone="solid">{t("early.done")}</Notice>
        </div>
      )}

      {active && isOwner && (
        <div className="actions-bar">
          <div className="action-cell">
            <button type="button" className="btn btn-lg" onClick={withdraw} disabled={!matured || flow.status === "running"}>
              {t("detail.unlockAtMaturity")}
            </button>
            <span className="small muted">
              {matured ? t("detail.matured") : t("detail.unlockAtMaturityHint", { date: formatDate(lock.end, locale) })}
            </span>
          </div>
          <div className="action-cell">
            <button
              type="button"
              className="btn btn-secondary btn-lg"
              onClick={() => setEarlyOpen(true)}
              disabled={matured || flow.status === "running"}
            >
              {t("detail.unlockEarly")}
            </button>
            <span className="small muted">
              {matured ? t("error.LockMatured") : t("detail.unlockEarlyHint", { fee: formatBps(currentFee, locale) })}
            </span>
          </div>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
      {active && isOwner && matured && lock.vault && (
        <SharesFallback lock={lock} withdrawFailed={flow.status === "error"} onDone={() => void query.refetch()} />
      )}

      <section className="section">
        <dl className="dl">
          <DetailRow label={t("detail.asset")}>
            {asset.name} ({asset.symbol})
          </DetailRow>
          <DetailRow label={t("detail.amount")}>
            <span className="num">{fmt(lock.amount)}</span>
          </DetailRow>
          <DetailRow label={t("detail.value")}>
            <span className="num">
              {active ? fmt(lock.currentValue) : t("common.none")}
              {active && usd !== undefined && ` · ${formatUsd(usd, locale)}`}
            </span>
          </DetailRow>
          <DetailRow label={t("detail.contract")}>
            <AddressLink address={deployment!.contracts.lockVault} chainId={chainId} />
          </DetailRow>
          <DetailRow label={t("detail.network")}>{chain?.name}</DetailRow>
          <DetailRow label={t("detail.created")}>{formatDate(lock.start, locale)}</DetailRow>
          <DetailRow label={t("detail.unlockDate")}>{formatDate(lock.end, locale)}</DetailRow>
          <DetailRow label={t("detail.totalDuration")}>{formatDurationLong(lock.end - lock.start, t)}</DetailRow>
          <DetailRow label={t("detail.remaining")}>
            {active && !matured ? formatDurationShort(lock.end - now, t) : t("common.none")}
          </DetailRow>
          <DetailRow label={t("detail.staking")}>{lock.vault ? t("detail.stakingOn") : t("detail.stakingOff")}</DetailRow>
          {lock.vault && (
            <DetailRow label={t("detail.vault")}>
              <span>
                {shareToken?.name ? `${shareToken.name} · ` : ""}
                <AddressLink address={lock.vault} chainId={chainId} />
              </span>
            </DetailRow>
          )}
          <DetailRow label={t("detail.rewards")}>
            {asShares ? (
              <span className="muted">{t("detail.rewardsInShares")}</span>
            ) : rewards === null ? (
              <span className="muted">{t("detail.rewardsNa")}</span>
            ) : (
              <span className="num">
                {rewards >= 0n ? "+" : ""}
                {fmt(rewards)}
              </span>
            )}
          </DetailRow>
          {balanceChange !== 0n && (
            <DetailRow label={t("detail.valueChange")}>
              <span>
                <span className="num">
                  {balanceChange > 0n ? "+" : ""}
                  {fmt(balanceChange)}
                </span>
                <br />
                <span className="small muted">{t("detail.valueChangeHint")}</span>
              </span>
            </DetailRow>
          )}
          <DetailRow label={t("detail.feeTerms")}>
            <span className="num">
              {formatBps(lock.maxFeeBps, locale)} → {formatBps(lock.minFeeBps, locale)}
            </span>
          </DetailRow>
          {active && !matured && (
            <DetailRow label={t("detail.currentFee")}>
              <span className="num">{formatBps(currentFee, locale)}</span>
            </DetailRow>
          )}
          {!active && <DetailRow label={t("detail.closedAt")}>{formatDate(lock.closedAt, locale)}</DetailRow>}
          {!active && (
            <DetailRow label={t("detail.feePaid")}>
              <span className="num">{lock.fee > 0n ? fmt(lock.fee) : t("common.none")}</span>
            </DetailRow>
          )}
          {!active && (
            <DetailRow label={t("detail.received")}>
              <span className="num">{asShares ? fmtShares(lock.shares) : fmt(lock.amountOut)}</span>
            </DetailRow>
          )}
          <DetailRow label={t("detail.owner")}>
            <AddressLink address={lock.owner} chainId={chainId} />
          </DetailRow>
        </dl>
      </section>

      {active && isOwner && !matured && (
        <EarlyUnlockModal
          open={earlyOpen}
          onClose={() => setEarlyOpen(false)}
          detail={detail}
          asset={asset}
          refresh={() => void query.refetch()}
          onDone={() => {
            setEarlyOpen(false);
            setEarlyDone(true);
          }}
        />
      )}
    </>
  );
}

function SharesFallback({ lock, withdrawFailed, onDone }: { lock: CryptoLock; withdrawFailed: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const config = useConfig();
  const { client, ready, deployment, address, chainId } = useReadyClient();
  const flow = useTxFlow();
  const holder = deployment!.contracts.lockVault;
  const limit = useQuery({
    queryKey: ["maxRedeem", chainId, lock.vault, holder],
    enabled: ready && !!lock.vault,
    refetchInterval: 30_000,
    queryFn: () => client!.readContract({ address: lock.vault!, abi: erc4626Abi, functionName: "maxRedeem", args: [holder] }),
  });
  const blocked = limit.data !== undefined && limit.data < lock.shares;
  if (!blocked && !withdrawFailed && flow.status === "idle") return null;

  const withdrawShares = async () => {
    const receipts = await flow.run([
      {
        id: "withdraw-shares",
        label: t("detail.sharesFallbackAction"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: holder,
            abi: lockVaultAbi,
            functionName: "withdrawShares",
            args: [lock.id],
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);
    if (receipts) onDone();
  };

  return (
    <section className="section stack-16">
      <Notice tone="solid">
        <p>
          <strong>{t("detail.sharesFallbackTitle")}</strong>
        </p>
        <p>{t("detail.sharesFallbackBody")}</p>
      </Notice>
      <div>
        <button type="button" className="btn btn-secondary" onClick={withdrawShares} disabled={flow.status === "running"}>
          {t("detail.sharesFallbackAction")}
        </button>
      </div>
      <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
    </section>
  );
}
