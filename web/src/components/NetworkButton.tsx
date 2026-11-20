"use client";

import { useState } from "react";
import { useSwitchChain } from "wagmi";
import { Modal } from "./Modal";
import { IconSearch, Spinner } from "./Icons";
import { chains, isTestnet, LOCAL_CHAIN_ID, PRIMARY_CHAIN_ID, PRIMARY_TESTNET_ID, primaryRank, type SupportedChain } from "@/config/chains";
import { getDeployment, getOutdatedDeployment } from "@/config/deployments";
import { useNetwork } from "@/hooks/useNetwork";
import { useI18n } from "@/lib/i18n";
import { useMounted } from "@/lib/useMounted";

export function NetworkList({ onSwitched }: { onSwitched?: () => void }) {
  const { t } = useI18n();
  const { chainId } = useNetwork();
  const { switchChain, isPending, variables } = useSwitchChain();
  const [query, setQuery] = useState("");

  const listed = chains.filter((chain) => chain.id !== LOCAL_CHAIN_ID || getDeployment(LOCAL_CHAIN_ID));
  const q = query.trim().toLowerCase();
  const matches = listed.filter(
    (chain) => !q || chain.name.toLowerCase().includes(q) || String(chain.id).includes(q) || chain.nativeCurrency.symbol.toLowerCase() === q,
  );
  const ordered = [...matches].sort((a, b) => primaryRank(a.id) - primaryRank(b.id));
  const available = ordered.filter((chain) => getDeployment(chain.id));
  const groups: Array<[string, SupportedChain[]]> = [
    [t("network.groupAvailable"), available],
    [t("network.groupMainnets"), ordered.filter((chain) => !getDeployment(chain.id) && !isTestnet(chain))],
    [t("network.groupTestnets"), ordered.filter((chain) => !getDeployment(chain.id) && isTestnet(chain))],
  ];

  return (
    <div className="stack-16">
      <label className="search">
        <IconSearch />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("network.search")}
          aria-label={t("network.search")}
        />
      </label>
      <div className="network-scroll">
        {matches.length === 0 && <p className="muted">{t("network.noResults")}</p>}
        {groups.map(([title, items]) =>
          items.length === 0 ? null : (
            <div key={title} className="network-group">
              <div className="eyebrow muted network-group-title">
                {title} · {items.length}
              </div>
              <div className="option-list">
                {items.map((chain) => {
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
                          {chain.nativeCurrency.symbol} · {chain.id}
                          {chain.id === PRIMARY_CHAIN_ID
                            ? ` · ${t("network.primaryTag")}`
                            : chain.id === PRIMARY_TESTNET_ID
                              ? ` · ${t("network.primaryTestTag")}`
                              : isTestnet(chain) && ` · ${chain.id === LOCAL_CHAIN_ID ? t("network.localTag") : t("network.testnet")}`}
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
            </div>
          ),
        )}
      </div>
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
