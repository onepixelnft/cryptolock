"use client";

import { useSwitchChain } from "wagmi";
import { chainById, primaryRank } from "@/config/chains";
import { deployedChainIds } from "@/config/deployments";
import { useNetwork } from "@/hooks/useNetwork";
import { useI18n } from "@/lib/i18n";
import { useMounted } from "@/lib/useMounted";
import { IconAlert } from "./Icons";

export function NetworkBanner() {
  const { t } = useI18n();
  const mounted = useMounted();
  const { status, chain, deployment, outdated } = useNetwork();
  const { switchChain, isPending } = useSwitchChain();
  if (!mounted) return null;

  if (status === "ready" && deployment?.isLocal) {
    return (
      <div className="strip">
        <div className="container strip-inner small">{t("network.local")}</div>
      </div>
    );
  }
  if (status === "ready" && chain?.testnet) {
    return (
      <div className="strip">
        <div className="container strip-inner small">{t("network.testnetStrip", { name: chain.name })}</div>
      </div>
    );
  }
  if (status !== "unsupported" && status !== "not-deployed") return null;

  const targets = [...deployedChainIds]
    .sort((a, b) => primaryRank(a) - primaryRank(b))
    .map((id) => chainById(id))
    .filter((c) => c !== undefined);
  return (
    <div className="banner" role="alert">
      <div className="container banner-inner">
        <IconAlert size={18} />
        <div className="banner-text">
          <strong>
            {status === "unsupported"
              ? t("network.unsupported")
              : outdated
                ? t("network.outdated", { name: chain?.name ?? "" })
                : t("network.notDeployed", { name: chain?.name ?? "" })}
          </strong>
          <span>
            {status === "unsupported"
              ? t("network.unsupportedHint")
              : outdated
                ? t("network.outdatedHint")
                : t("network.notDeployedHint")}
          </span>
        </div>
        <div className="banner-actions">
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className="btn btn-sm btn-inverse"
              disabled={isPending}
              onClick={() => switchChain({ chainId: target.id })}
            >
              {t("network.switchTo", { name: target.name })}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
