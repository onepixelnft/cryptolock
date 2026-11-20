"use client";

import { useEffect, useRef } from "react";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { nftLockVaultAbi } from "@/generated/abis";
import type { NftLockDetail } from "@/hooks/nft";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useChainNow } from "@/lib/chainClock";
import { formatAmount, formatDate } from "@/lib/format";
import { formatDaysPrecise, formatDurationShort, useI18n } from "@/lib/i18n";
import { Modal } from "./Modal";
import { DetailRow, TxProgress } from "./ui";

export function NftEarlyUnlockModal({
  open,
  onClose,
  detail,
  label,
  refresh,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  detail: NftLockDetail;
  label: string;
  refresh: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, deployment, chainId } = useNetwork();
  const flow = useTxFlow();
  const busy = flow.status === "running";
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const { lock, preview } = detail;
  const native = deployment!.native;
  const fmt = (v: bigint) => `${formatAmount(v, native.decimals, locale, 6)} ${native.symbol}`;

  useEffect(() => {
    if (open) refreshRef.current();
  }, [open]);

  const confirm = async () => {
    const receipts = await flow.run([
      {
        id: "nft-unlock-early",
        label: t("detail.unlockEarly"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: deployment!.contracts.nftLockVault!,
            abi: nftLockVaultAbi,
            functionName: "unlockEarly",
            args: [lock.id],
            value: preview.fee,
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);
    if (receipts) onDone();
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        flow.reset();
        onClose();
      }}
      locked={busy}
      title={t("early.title")}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn" onClick={confirm} disabled={busy || preview.fee === 0n}>
            {t("early.confirm")}
          </button>
        </>
      }
    >
      <div className="stack-16">
        <dl className="dl dl-single">
          <DetailRow label={t("detail.asset")}>{label}</DetailRow>
          <DetailRow label={t("early.normalDate")}>{formatDate(lock.end, locale)}</DetailRow>
          <DetailRow label={t("early.remaining")}>{formatDurationShort(Math.max(0, lock.end - now), t)}</DetailRow>
          <DetailRow label={t("early.fee")}>
            <strong className="num">{fmt(preview.fee)}</strong>
          </DetailRow>
        </dl>
        <details className="disclosure">
          <summary>{t("early.calc")}</summary>
          <div className="formula">
            {t("early.calcRate", {
              min: fmt(lock.minFee),
              max: fmt(lock.maxFee),
              remaining: formatDaysPrecise(lock.end - preview.at, t, locale),
              total: formatDaysPrecise(lock.end - lock.start, t, locale),
              rate: fmt(preview.fee),
            })}
          </div>
        </details>
        <p className="small muted">{t("early.nftFeeNote", { symbol: native.symbol })}</p>
        <p className="small muted">{t("early.source", { block: preview.block.toString() })}</p>
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </Modal>
  );
}
