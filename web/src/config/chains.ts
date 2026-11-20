import type { Chain } from "viem";
import { hardhat, polygon } from "wagmi/chains";

export const PRIMARY_CHAIN_ID = polygon.id;

export const PRODUCTION = process.env.NEXT_PUBLIC_APP_MODE === "production";

export const LOCAL_CHAIN_ID = hardhat.id;

export const chains: readonly [Chain, ...Chain[]] = PRODUCTION ? [polygon] : [polygon, hardhat];

export type SupportedChain = Chain;
export type SupportedChainId = number;

const configuredDefault = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);
export const AUTO_SWITCH = Number.isInteger(configuredDefault) && chains.some((c) => c.id === configuredDefault);
export const PREFERRED_CHAIN_ID: number = AUTO_SWITCH ? configuredDefault : PRIMARY_CHAIN_ID;

export function chainById(chainId: number | undefined): SupportedChain | undefined {
  return chains.find((c) => c.id === chainId);
}

export function isTestnet(chain: SupportedChain): boolean {
  return chain.id === LOCAL_CHAIN_ID || chain.testnet === true;
}

export function primaryRank(chainId: number): number {
  if (chainId === PREFERRED_CHAIN_ID) return 0;
  return chainId === PRIMARY_CHAIN_ID ? 1 : 2;
}

export function explorerUrl(chainId: number | undefined, kind: "address" | "tx", value: string): string | undefined {
  const explorer = chainById(chainId)?.blockExplorers?.default.url.replace(/\/$/, "");
  return explorer ? `${explorer}/${kind}/${value}` : undefined;
}
