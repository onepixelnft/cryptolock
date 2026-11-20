"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { nftLockVaultAbi } from "@/generated/abis";
import { IconArrowLeft } from "@/components/Icons";
import { NftEarlyUnlockModal } from "@/components/NftEarlyUnlockModal";
import { NftImage, useNftLabel } from "@/components/NftImage";
import { RequireReady } from "@/components/RequireReady";
import { AddressLink, Countdown, DetailRow, type LockState, Notice, Skeleton, StatusChip, TxProgress } from "@/components/ui";
import { useCollectionName, useNftLock } from "@/hooks/nft";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useChainNow } from "@/lib/chainClock";
import { feeBpsAt } from "@/lib/fees";
import { formatAmount, formatDate } from "@/lib/format";
import { formatDurationLong, formatDurationShort, useI18n } from "@/lib/i18n";

export default function NftLockPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="container page">
      <RequireReady>
        <NftLockDetail idParam={params.id} />
      </RequireReady>
    </div>
  );
}

function NftLockDetail({ idParam }: { idParam: string }) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, deployment, chain, chainId } = useNetwork();
  const id = /^\d+$/.test(idParam) ? BigInt(idParam) : undefined;
  const query = useNftLock(id);
  const lock = query.data?.lock;
  const collectionName = useCollectionName(lock?.collection).data ?? "";
  const label = useNftLabel(lock, collectionName);
  const flow = useTxFlow();
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyDone, setEarlyDone] = useState(false);
  const native = deployment!.native;
  const fmtNative = (v: bigint) => `${formatAmount(v, native.decimals, locale, 6)} ${native.symbol}`;

  const back = (
    <Link href="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
      <IconArrowLeft /> {t("nav.dashboard")}
    </Link>
  );

  if (!deployment?.contracts.nftLockVault) {
    return (
      <div className="gate">
        {back}
        <h1 className="h2">{t("create.nft.unavailable", { network: chain?.name ?? "" })}</h1>
      </div>
    );
  }
  if (query.isLoading) {
    return (
      <div className="stack-16">
        {back}
        <Skeleton width="50%" height={40} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (!query.data || !lock) {
    return (
      <div className="gate">
        {back}
        <h1 className="h2">{t("detail.notFound")}</h1>
      </div>
    );
  }

  const detail = query.data;
  const isOwner = !!address && address.toLowerCase() === lock.owner.toLowerCase();
  const matured = now >= lock.end;
  const active = lock.status === "active";
  const state: LockState =
    lock.status === "withdrawn" ? "completed" : lock.status === "early" ? "early" : matured ? "unlockable" : "active";
  const currentFee = active && !matured ? BigInt(feeBpsAt(0, 1_000_000, lock.start, lock.end, now)) : 0n;
  const currentFeeAmount = lock.minFee + ((lock.maxFee - lock.minFee) * currentFee) / 1_000_000n;

  const withdraw = () =>
    flow.run([
      {
        id: "nft-withdraw",
        label: t("detail.unlockAtMaturity"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: deployment.contracts.nftLockVault!,
            abi: nftLockVaultAbi,
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
          <div className="eyebrow">{t("detail.nftTitle", { id: lock.id.toString() })}</div>
          <div className="detail-amount">
            <div className="nft-hero">
              <NftImage nft={lock} fill />
            </div>
            <div>
              <div className="h2">{label}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {lock.standard === "erc1155" ? t("history.nftUnits", { n: lock.amount.toString() }) : t("history.oneNft")} ·{" "}
                {lock.standard.toUpperCase().replace("ERC", "ERC-")}
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
      {!active && <Notice>{lock.status === "withdrawn" ? t("detail.withdrawn") : t("detail.closed")}</Notice>}
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
              {matured ? t("error.LockMatured") : t("detail.unlockEarlyHint", { fee: fmtNative(currentFeeAmount) })}
            </span>
          </div>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>

      <section className="section">
        <dl className="dl">
          <DetailRow label={t("detail.collection")}>
            <span>
              {collectionName ? `${collectionName} · ` : ""}
              <AddressLink address={lock.collection} chainId={chainId} />
            </span>
          </DetailRow>
          <DetailRow label={t("detail.tokenId")}>
            <span className="mono break">{lock.tokenId.toString()}</span>
          </DetailRow>
          <DetailRow label={t("detail.standard")}>{lock.standard.toUpperCase().replace("ERC", "ERC-")}</DetailRow>
          <DetailRow label={t("detail.units")}>{lock.amount.toString()}</DetailRow>
          <DetailRow label={t("detail.contract")}>
            <AddressLink address={deployment.contracts.nftLockVault} chainId={chainId} />
          </DetailRow>
          <DetailRow label={t("detail.network")}>{chain?.name}</DetailRow>
          <DetailRow label={t("detail.created")}>{formatDate(lock.start, locale)}</DetailRow>
          <DetailRow label={t("detail.unlockDate")}>{formatDate(lock.end, locale)}</DetailRow>
          <DetailRow label={t("detail.totalDuration")}>{formatDurationLong(lock.end - lock.start, t)}</DetailRow>
          <DetailRow label={t("detail.remaining")}>
            {active && !matured ? formatDurationShort(lock.end - now, t) : t("common.none")}
          </DetailRow>
          <DetailRow label={t("detail.staking")}>
            <span className="muted">{t("detail.stakingNa")}</span>
          </DetailRow>
          <DetailRow label={t("detail.feeTerms")}>
            <span className="num">
              {fmtNative(lock.maxFee)} → {fmtNative(lock.minFee)}
            </span>
          </DetailRow>
          {!active && <DetailRow label={t("detail.closedAt")}>{formatDate(lock.closedAt, locale)}</DetailRow>}
          {!active && (
            <DetailRow label={t("detail.feePaid")}>
              <span className="num">{lock.feePaid > 0n ? fmtNative(lock.feePaid) : t("common.none")}</span>
            </DetailRow>
          )}
          <DetailRow label={t("detail.owner")}>
            <AddressLink address={lock.owner} chainId={chainId} />
          </DetailRow>
        </dl>
      </section>

      {active && isOwner && !matured && (
        <NftEarlyUnlockModal
          open={earlyOpen}
          onClose={() => setEarlyOpen(false)}
          detail={detail}
          label={label}
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
