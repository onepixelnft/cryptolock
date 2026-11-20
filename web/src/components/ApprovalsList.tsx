"use client";

import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { lockableAccountAbi } from "@/generated/abis";
import { type LockAccountState, type TrackedApproval, useAssets } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { APPROVAL_KIND_LABEL, revokeCalldata } from "@/lib/approvals";
import { shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { AddressLink, TxProgress } from "./ui";

export function ApprovalsList({ account, onlyLive = false }: { account: LockAccountState; onlyLive?: boolean }) {
  const { t } = useI18n();
  const config = useConfig();
  const { address, chainId } = useNetwork();
  const { resolve } = useAssets();
  const flow = useTxFlow();
  const rows = onlyLive ? account.approvals.filter((a) => a.live) : account.approvals;

  const revoke = (approval: TrackedApproval) =>
    flow.run([
      {
        id: `revoke-${approval.token}-${approval.spender}-${approval.kind}-${approval.id}`,
        label: `${t("create.wallet.revoke")} · ${shortAddress(approval.spender)}`,
        send: async () => {
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "execute",
            args: [approval.token, 0n, revokeCalldata(approval)],
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);

  if (rows.length === 0) return <p className="muted" style={{ paddingTop: 16 }}>{t("walletPage.noApprovals")}</p>;

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>{t("common.asset")}</th>
            <th>{t("table.kind")}</th>
            <th>{t("table.spender")}</th>
            <th>{t("table.status")}</th>
            <th className="align-right">{t("table.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const resolved = resolve(a.token);
            const asset = resolved.symbol === "?" ? undefined : resolved;
            return (
              <tr key={`${a.token}-${a.spender}-${a.kind}-${a.id}`}>
                <td className="cell-primary">
                  {asset ? <strong>{asset.symbol}</strong> : <AddressLink address={a.token} chainId={chainId} />}
                  {a.kind === 1 && <span className="muted small"> #{a.id.toString()}</span>}
                </td>
                <td data-label={t("table.kind")}>{APPROVAL_KIND_LABEL[a.kind] ?? a.kind}</td>
                <td data-label={t("table.spender")}>
                  <AddressLink address={a.spender} chainId={chainId} />
                </td>
                <td data-label={t("table.status")}>{a.live ? t("walletPage.live") : t("walletPage.inactive")}</td>
                <td data-label={t("table.actions")} className="align-right">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!a.live || account.isLocked || flow.status === "running"}
                    onClick={() => revoke(a)}
                  >
                    {t("create.wallet.revoke")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
    </>
  );
}
