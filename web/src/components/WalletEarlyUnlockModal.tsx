"use client";

import { useEffect, useRef } from "react";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { lockableAccountAbi } from "@/generated/abis";
import { type LockAccountState, type WalletLockRecord, useAssets } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useChainNow } from "@/lib/chainClock";
import { formatAmount, formatBps, formatDate } from "@/lib/format";
import { formatDaysPrecise, formatDurationShort, useI18n } from "@/lib/i18n";
import { Modal } from "./Modal";
import { DetailRow, TxProgress } from "./ui";

export function WalletEarlyUnlockModal({
  open,
  onClose,
  account,
  lock,
  refresh,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  account: LockAccountState;
  lock: WalletLockRecord;
  refresh: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, chainId } = useNetwork();
  const { resolve } = useAssets();
  const flow = useTxFlow();
  const busy = flow.status === "running";
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (open) refreshRef.current();
  }, [open]);

  const preview = account.preview;
  const remaining = Math.max(0, lock.end - now);
  const rows = preview
    ? preview.assets
        .map((assetAddress, i) => ({
          asset: resolve(assetAddress),
          balance: preview.balances[i],
          fee: preview.fees[i],
        }))
        .filter((row) => row.balance > 0n)
    : [];

  const confirm = async () => {
    const receipts = await flow.run([
      {
        id: "wallet-unlock-early",
        label: t("detail.unlockEarly"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "unlockEarly",
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
      wide
      title={t("early.title")}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn" onClick={confirm} disabled={busy || !preview}>
            {t("early.confirm")}
          </button>
        </>
      }
    >
      <div className="stack-16">
        <dl className="dl dl-single">
          <DetailRow label={t("early.normalDate")}>{formatDate(lock.end, locale)}</DetailRow>
          <DetailRow label={t("early.remaining")}>{formatDurationShort(remaining, t)}</DetailRow>
          <DetailRow label={t("early.fee")}>
            <strong className="num">{preview ? formatBps(preview.feeBps, locale) : t("common.none")}</strong>
          </DetailRow>
        </dl>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t("early.walletAssets")}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.asset")}</th>
                <th className="align-right">{t("early.locked")}</th>
                <th className="align-right">{t("early.fee")}</th>
                <th className="align-right">{t("early.walletAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset, balance, fee }) => (
                <tr key={asset.key}>
                  <td className="cell-primary">
                    <strong>{asset.symbol}</strong>
                  </td>
                  <td data-label={t("early.locked")} className="align-right num">
                    {formatAmount(balance, asset.decimals, locale)}
                  </td>
                  <td data-label={t("early.fee")} className="align-right num">
                    {formatAmount(fee, asset.decimals, locale)}
                  </td>
                  <td data-label={t("early.walletAfter")} className="align-right num">
                    {formatAmount(balance - fee, asset.decimals, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="disclosure">
          <summary>{t("early.calc")}</summary>
          <div className="formula">
            {preview &&
              t("early.calcRate", {
                min: formatBps(lock.minFeeBps, locale),
                max: formatBps(lock.maxFeeBps, locale),
                remaining: formatDaysPrecise(lock.end - preview.at, t, locale),
                total: formatDaysPrecise(lock.end - lock.start, t, locale),
                rate: formatBps(preview.feeBps, locale),
              })}
          </div>
        </details>
        <p className="small muted">{t("early.walletNote")}</p>
        {preview && <p className="small muted">{t("early.source", { block: preview.block.toString() })}</p>}
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </Modal>
  );
}
