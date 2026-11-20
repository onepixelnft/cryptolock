"use client";

import { useMemo, useState } from "react";
import { useConnect, useDisconnect, type Connector } from "wagmi";
import { Modal } from "./Modal";
import { IconArrowRight, IconCopy, IconShield, IconWallet, Spinner } from "./Icons";
import { useNetwork } from "@/hooks/useNetwork";
import { useI18n } from "@/lib/i18n";
import { useMounted } from "@/lib/useMounted";
import { shortAddress } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { walletConnectProjectId } from "@/config/wagmi";

export function ConnectButton({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const { address, isConnected, isConnecting, connector } = useNetwork();
  const { connectors, connect, isPending, error, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const options = useMemo(() => {
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.find((c) => c.id === "injected");
    const injectedList: Connector[] = discovered.length > 0 ? discovered : generic ? [generic] : [];
    const wc = connectors.find((c) => c.type === "walletConnect");
    return { injectedList, wc };
  }, [connectors]);

  const hasBrowserWallet = mounted && (options.injectedList.some((c) => c.id !== "injected") || "ethereum" in window);
  const btnClass = size === "lg" ? "btn btn-lg" : "btn btn-sm";

  if (!mounted) {
    return (
      <button type="button" className={btnClass} disabled>
        {t("wallet.connect")}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <>
        <button type="button" className="btn btn-secondary btn-sm mono" onClick={() => setOpen(true)}>
          {shortAddress(address)}
        </button>
        <Modal open={open} title={t("wallet.account")} onClose={() => setOpen(false)}>
          <div className="stack-16">
            <div>
              <div className="eyebrow muted">{connector?.name}</div>
              <div className="mono break" style={{ marginTop: 8 }}>
                {address}
              </div>
            </div>
            <div className="row-8">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(address);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  } catch {
                  }
                }}
              >
                <IconCopy /> {copied ? t("wallet.copied") : t("wallet.copy")}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                {t("wallet.disconnect")}
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  const pendingId = isPending ? variables?.connector && "id" in variables.connector ? variables.connector.id : undefined : undefined;
  const connectError = error ? describeError(error) : null;

  return (
    <>
      <button type="button" className={btnClass} onClick={() => setOpen(true)}>
        {isConnecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      <Modal open={open} title={t("wallet.choose")} onClose={() => setOpen(false)}>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("wallet.chooseHint")}
        </p>
        <div className="option-list">
          {options.injectedList.map((c) => (
            <button
              key={c.uid}
              type="button"
              className="option-row"
              disabled={isPending || (c.id === "injected" && !hasBrowserWallet)}
              onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
            >
              <IconWallet size={20} />
              <span className="option-text">
                <strong>{c.id === "injected" ? t("wallet.injected") : c.name}</strong>
                <span className="muted small">
                  {c.id === "injected" && !hasBrowserWallet ? t("wallet.injectedMissing") : t("wallet.injectedHint")}
                </span>
              </span>
              {pendingId === c.id ? <Spinner /> : <IconArrowRight />}
            </button>
          ))}
          {options.wc ? (
            <button
              type="button"
              className="option-row"
              disabled={isPending}
              onClick={() => {
                connect({ connector: options.wc! }, { onSuccess: () => setOpen(false) });
                setOpen(false);
              }}
            >
              <IconWallet size={20} />
              <span className="option-text">
                <strong>{t("wallet.walletconnect")}</strong>
                <span className="muted small">{t("wallet.walletconnectHint")}</span>
              </span>
              {pendingId === options.wc.id ? <Spinner /> : <IconArrowRight />}
            </button>
          ) : (
            <div className="option-row is-disabled" aria-disabled>
              <IconWallet size={20} />
              <span className="option-text">
                <strong>{t("wallet.walletconnect")}</strong>
                <span className="muted small">
                  {walletConnectProjectId ? t("wallet.walletconnectHint") : t("wallet.walletconnectMissing")}
                </span>
              </span>
            </div>
          )}
        </div>
        {connectError && <p className="error-text">{t(connectError.key, connectError.vars)}</p>}
        <p className="small muted row-8" style={{ marginBottom: 0 }}>
          <IconShield /> {t("wallet.never")}
        </p>
      </Modal>
    </>
  );
}
