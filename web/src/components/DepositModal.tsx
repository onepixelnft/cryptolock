"use client";

import { useState } from "react";
import { useConfig, useEstimateFeesPerGas } from "wagmi";
import { sendTransaction, simulateContract, writeContract } from "wagmi/actions";
import { type Address, erc20Abi, formatUnits } from "viem";
import { Modal } from "./Modal";
import { TokenIcon } from "./TokenIcon";
import { TxProgress } from "./ui";
import { useAssets, useBalances } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import { formatAmount, parseAmount } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function DepositModal({ open, onClose, account }: { open: boolean; onClose: () => void; account: Address }) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { address, deployment, chainId } = useNetwork();
  const balances = useBalances(address).data;
  const flow = useTxFlow();
  const assets = useAssets().assets.filter((a) => a.kind !== "vault");
  const [key, setKey] = useState(assets[0]?.key ?? "native");
  const [input, setInput] = useState("");

  const fees = useEstimateFeesPerGas();
  const asset = assets.find((a) => a.key === key) ?? assets[0];
  const balance = balances?.[asset.key] ?? 0n;
  const perGas = fees.data?.maxFeePerGas ?? fees.data?.gasPrice;
  const reserve = asset.kind === "native" ? (perGas ? perGas * 100_000n : 10n ** 15n) : 0n;
  const max = balance > reserve ? balance - reserve : 0n;
  const amount = parseAmount(input, asset.decimals);
  const invalid = input !== "" && (amount === null || amount === 0n);
  const tooHigh = amount !== null && amount > max;
  const busy = flow.status === "running";

  const close = () => {
    if (busy) return;
    flow.reset();
    setInput("");
    onClose();
  };

  const submit = async () => {
    if (!amount || !address) return;
    await flow.run([
      {
        id: "deposit",
        label: `${t("create.wallet.deposit")} ${asset.symbol}`,
        send: async () => {
          if (asset.kind === "native") return sendTransaction(config, { to: account, value: amount });
          const { request } = await simulateContract(config, {
            address: asset.address,
            abi: erc20Abi,
            functionName: "transfer",
            args: [account, amount],
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);
  };

  return (
    <Modal
      open={open}
      title={t("walletPage.depositTitle")}
      onClose={close}
      locked={busy}
      footer={
        flow.status === "success" ? (
          <button type="button" className="btn" onClick={close}>
            {t("common.close")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn" onClick={submit} disabled={busy || !amount || tooHigh}>
              {t("create.wallet.deposit")}
            </button>
          </>
        )
      }
    >
      <div className="stack-16">
        <p className="muted small">{t("walletPage.depositHint")}</p>
        <div className="option-list">
          {assets.map((a) => (
            <button
              key={a.key}
              type="button"
              className="option-row"
              aria-pressed={a.key === asset.key}
              onClick={() => {
                setKey(a.key);
                setInput("");
              }}
              disabled={busy}
            >
              <TokenIcon symbol={a.symbol} />
              <span className="option-text">
                <strong>{a.symbol}</strong>
                <span className="muted small">{a.name}</span>
              </span>
              <span className="option-meta num small">{formatAmount(balances?.[a.key] ?? 0n, a.decimals, locale)}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label eyebrow">{t("common.amount")}</span>
          <div className="input-wrap">
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.0"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
            />
            <span className="input-suffix">{asset.symbol}</span>
          </div>
        </label>
        <div className="row-8 small" style={{ justifyContent: "space-between" }}>
          <span className="muted">{t("create.amount.available", { amount: `${formatAmount(balance, asset.decimals, locale)} ${asset.symbol}` })}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setInput(formatUnits(max, asset.decimals))}
            disabled={busy || max === 0n}
          >
            {t("common.max")}
          </button>
        </div>
        {asset.kind === "native" && <p className="small muted">{t("walletPage.depositGasReserve")}</p>}
        {invalid && <p className="error-text">{t("create.amount.invalid")}</p>}
        {tooHigh && <p className="error-text">{t("create.amount.tooHigh")}</p>}
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </Modal>
  );
}
