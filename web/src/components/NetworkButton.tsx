"use client";

import { useState } from "react";
import { useSwitchChain } from "wagmi";
import { Modal } from "./Modal";
import { Spinner } from "./Icons";
import { chains, LOCAL_CHAIN_ID, PRIMARY_CHAIN_ID, primaryRank } from "@/config/chains";
import { getDeployment, getOutdatedDeployment } from "@/config/deployments";
import { useNetwork } from "@/hooks/useNetwork";
import { useI18n } from "@/lib/i18n";
import { useMounted } from "@/lib/useMounted";

export function NetworkList({ onSwitched }: { onSwitched?: () => void }) {
  const { t } = useI18n();
  const { chainId } = useNetwork();
  const { switchChain, isPending, variables } = useSwitchChain();

  const listed = chains
    .filter((chain) => chain.id !== LOCAL_CHAIN_ID || getDeployment(LOCAL_CHAIN_ID))
    .sort((a, b) => primaryRank(a.id) - primaryRank(b.id));

  return (
    <div className="option-list">
      {listed.map((chain) => {
        const deployed = !!getDeployment(chain.id);
        const current = chain.id === chainId;
        return (
          <button
            key={chain.id}
            type="button"
            className={`option-row${current ? " is-current" : ""}`}
            disabled={isPending || current}
            onClick={() => switchChain({ chainId: chain.id }, { onSuccess: () => onSwitched?.() })}
          >
            <span className={`net-dot${deployed ? " is-on" : ""}`} aria-hidden />
            <span className="option-text">
              <strong>{chain.name}</strong>
              <span className="muted small">
                {chain.nativeCurrency.symbol} · {chain.id} ·{" "}
                {chain.id === PRIMARY_CHAIN_ID ? t("network.primaryTag") : t("network.localTag")}
              </span>
            </span>
            <span className="option-meta small">
              {isPending && variables?.chainId === chain.id ? (
                <Spinner />
              ) : deployed ? (
                t("network.available")
              ) : getOutdatedDeployment(chain.id) ? (
                <span className="muted">{t("network.outdatedTag")}</span>
              ) : (
                <span className="muted">{t("network.notAvailable")}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NetworkButton() {
  const { t } = useI18n();
  const mounted = useMounted();
  const { isConnected, chain, status } = useNetwork();
  const [open, setOpen] = useState(false);
  if (!mounted || !isConnected) return null;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm net-button" onClick={() => setOpen(true)}>
        <span className={`net-dot${status === "ready" ? " is-on" : ""}`} aria-hidden />
        <span className="hide-sm">{chain?.name ?? t("network.unsupported")}</span>
      </button>
      <Modal open={open} title={t("network.title")} onClose={() => setOpen(false)}>
        <NetworkList onSwitched={() => setOpen(false)} />
      </Modal>
    </>
  );
}
