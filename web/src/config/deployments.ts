import type { Address } from "viem";
import { PRODUCTION } from "./chains";
import raw from "./deployments.json";

export interface DeployedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  priceFeed?: Address;
  kind: "token" | "vault";
  underlying?: Address;
}

export interface DeployedNftCollection {
  address: Address;
  name: string;
  symbol: string;
  standard: "erc721" | "erc1155";
  enumerable?: boolean;
  ids?: number[];
}

export const PROTOCOL_VERSION = 3;

export interface Deployment {
  chainId: number;
  name: string;
  protocolVersion?: number;
  isLocal: boolean;
  deployBlock: number;
  deployedAt: string;
  contracts: {
    protocolConfig: Address;
    lockVault: Address;
    accountFactory: Address;
    nftLockVault?: Address;
  };
  wrappedNative: Address;
  native: { symbol: string; name: string; decimals: number; priceFeed?: Address };
  tokens: DeployedToken[];
  nftCollections?: DeployedNftCollection[];
  devUnlistedTokens?: Address[];
}

const deployments = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, Deployment>).filter(([, d]) => !(PRODUCTION && d.isLocal)),
);

const isCompatible = (d: Deployment) => (d.protocolVersion ?? 1) === PROTOCOL_VERSION;

export function getDeployment(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  const deployment = deployments[String(chainId)];
  return deployment && isCompatible(deployment) ? deployment : undefined;
}

export function getOutdatedDeployment(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  const deployment = deployments[String(chainId)];
  return deployment && !isCompatible(deployment) ? deployment : undefined;
}

export const deployedChainIds: number[] = Object.values(deployments)
  .filter(isCompatible)
  .map((d) => d.chainId);
