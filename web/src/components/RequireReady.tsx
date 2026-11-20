"use client";

import type { ReactNode } from "react";
import { useSwitchChain } from "wagmi";
import { PREFERRED_CHAIN_ID, chainById } from "@/config/chains";
import { getDeployment } from "@/config/deployments";
import { ConnectButton } from "./ConnectButton";
import { NetworkList } from "./NetworkButton";
import { useNetwork } from "@/hooks/useNetwork";
import { useI18n } from "@/lib/i18n";
import { useMounted } from "@/lib/useMounted";
import { Skeleton } from "./ui";

export function RequireReady({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const { status, chain, isConnecting, outdated } = useNetwork();
  const { switchChain, isPending } = useSwitchChain();
  const preferred = getDeployment(PREFERRED_CHAIN_ID) ? chainById(PREFERRED_CHAIN_ID) : undefined;

  if (!mounted || (isConnecting && status === "disconnected")) {
    return (
      <div className="section">
        <Skeleton width="40%" height={28} />
        <div style={{ height: 16 }} />
        <Skeleton height={120} />
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="gate">
        <h2 className="h2">{t("wallet.notConnectedTitle")}</h2>
        <p className="muted">{t("wallet.notConnectedBody")}</p>
        <ConnectButton size="lg" />
      </div>
    );
  }

  if (status !== "ready") {
    return (
      <div className="gate">
        <h2 className="h2">
          {status === "unsupported"
            ? t("network.unsupported")
            : outdated
              ? t("network.outdated", { name: chain?.name ?? "" })
              : t("network.notDeployed", { name: chain?.name ?? "" })}
        </h2>
        <p className="muted">
          {status === "unsupported"
            ? t("network.unsupportedHint")
            : outdated
              ? t("network.outdatedHint")
              : t("network.notDeployedHint")}
        </p>
        {preferred && preferred.id !== chain?.id && (
          <button
            type="button"
            className="btn btn-lg"
            disabled={isPending}
            onClick={() => switchChain({ chainId: preferred.id })}
          >
            {t("network.switchTo", { name: preferred.name })}
          </button>
        )}
        <div style={{ maxWidth: 420, width: "100%" }}>
          <NetworkList />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
