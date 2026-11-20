"use client";

import { useEffect, useRef } from "react";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { zeroAddress } from "viem";
import { lockVaultAbi } from "@/generated/abis";
import type { CryptoLockDetail } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import type { Asset } from "@/lib/assets";
import { useChainNow } from "@/lib/chainClock";
import { formatAmount, formatBps, formatDate } from "@/lib/format";
import { formatDaysPrecise, formatDurationShort, useI18n } from "@/lib/i18n";
import { Modal } from "./Modal";
import { DetailRow, TxProgress } from "./ui";

export function EarlyUnlockModal({
  open,
  onClose,
  detail,
  asset,
  onDone,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  detail: CryptoLockDetail;
  asset: Asset;
  onDone: () => void;
  refresh: () => void;
}) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, deployment, chainId } = useNetwork();
  const flow = useTxFlow();
  const { lock, preview } = detail;
  const busy = flow.status === "running";
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (open) refreshRef.current();
  }, [open]);

  const fmt = (v: bigint) => `${formatAmount(v, asset.decimals, locale)} ${asset.symbol}`;
  const total = lock.end - lock.start;
  const remaining = Math.max(0, lock.end - now);
  const remainingAtPreview = Math.max(0, lock.end - preview.at);
  const rate = formatBps(preview.feeBps, locale);

  const confirm = async () => {
    const valueCanMove = !!lock.vault || lock.token !== zeroAddress;
    const minAmountOut = valueCanMove ? (preview.amountOut * 995n) / 1000n : preview.amountOut;
    const receipts = await flow.run([
      {
        id: "unlock-early",
        label: t("detail.unlockEarly"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: deployment!.contracts.lockVault,
            abi: lockVaultAbi,
            functionName: "unlockEarly",
            args: [lock.id, minAmountOut],
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
          <button type="button" className="btn" onClick={confirm} disabled={busy || preview.gross === 0n}>
            {t("early.confirm")}
          </button>
        </>
      }
    >
      <div className="stack-16">
        <dl className="dl dl-single">
          <DetailRow label={t("early.locked")}>
            <span className="num">{fmt(preview.gross)}</span>
          </DetailRow>
          <DetailRow label={t("early.normalDate")}>{formatDate(lock.end, locale)}</DetailRow>
          <DetailRow label={t("early.remaining")}>{formatDurationShort(remaining, t)}</DetailRow>
          <DetailRow label={t("early.fee")}>
            <strong className="num">
              {fmt(preview.fee)} · {rate}
            </strong>
          </DetailRow>
          <DetailRow label={t("early.received")}>
            <strong className="num">{fmt(preview.amountOut)}</strong>
          </DetailRow>
        </dl>
        <details className="disclosure">
          <summary>{t("early.calc")}</summary>
          <div className="formula">
            {t("early.calcRate", {
              min: formatBps(lock.minFeeBps, locale),
              max: formatBps(lock.maxFeeBps, locale),
              remaining: formatDaysPrecise(remainingAtPreview, t, locale),
              total: formatDaysPrecise(total, t, locale),
              rate,
            })}
            <br />
            {t("early.calcAmount", { amount: fmt(preview.gross), rate, fee: fmt(preview.fee) })}
          </div>
        </details>
        <p className="small muted">{t("early.source", { block: preview.block.toString() })}</p>
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </Modal>
  );
}
