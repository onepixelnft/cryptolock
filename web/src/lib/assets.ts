import { type Address, zeroAddress } from "viem";
import type { Deployment } from "@/config/deployments";

export const NATIVE: Address = zeroAddress;

export interface Asset {
  key: string;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  priceFeed?: Address;
  kind: "native" | "token" | "vault";
  underlying?: Address;
  source?: "list" | "custom" | "discovered" | "detected";
}

export function assetKey(address: string): string {
  return address.toLowerCase() === NATIVE ? "native" : address.toLowerCase();
}

const NATIVE_MIRRORS = new Set([
  "0x0000000000000000000000000000000000001010",
  "0x0000000000000000000000000000000000000802",
  "0x471ece3750da237f93b8e339c536989b8978a438",
  "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000",
]);

export function isNativeMirror(address: string): boolean {
  return NATIVE_MIRRORS.has(address.toLowerCase());
}

export function assetsOf(deployment: Deployment): Asset[] {
  return [
    {
      key: "native",
      address: NATIVE,
      symbol: deployment.native.symbol,
      name: deployment.native.name,
      decimals: deployment.native.decimals,
      priceFeed: deployment.native.priceFeed,
      kind: "native",
    },
    ...deployment.tokens.map((t) => ({
      key: t.address.toLowerCase(),
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      priceFeed: t.priceFeed,
      kind: t.kind,
      underlying: t.underlying,
    })),
  ];
}

export function findAsset(deployment: Deployment, address: string): Asset | undefined {
  const key = assetKey(address);
  return assetsOf(deployment).find((a) => a.key === key);
}

export function unknownAsset(address: Address): Asset {
  return { key: address.toLowerCase(), address, symbol: "?", name: address, decimals: 18, kind: "token" };
}
