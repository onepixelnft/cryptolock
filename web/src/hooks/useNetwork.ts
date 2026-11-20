"use client";

import { useAccount, useChainId } from "wagmi";
import { chainById } from "@/config/chains";
import { getDeployment, getOutdatedDeployment } from "@/config/deployments";

export type NetworkStatus = "disconnected" | "unsupported" | "not-deployed" | "ready";

export function useNetwork() {
  const { address, isConnected, chainId: walletChainId, connector, status: accountStatus } = useAccount();
  const configChainId = useChainId();
  const chainId = isConnected ? walletChainId : configChainId;
  const chain = chainById(chainId);
  const deployment = getDeployment(chainId);

  let status: NetworkStatus = "ready";
  if (!isConnected) status = "disconnected";
  else if (!chain) status = "unsupported";
  else if (!deployment) status = "not-deployed";

  return {
    address,
    isConnected,
    chainId,
    chain,
    deployment,
    outdated: status === "not-deployed" && !!getOutdatedDeployment(chainId),
    status,
    connector,
    isConnecting: accountStatus === "connecting" || accountStatus === "reconnecting",
  };
}
