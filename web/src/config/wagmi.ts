import { createConfig, fallback, http, injected, type Transport } from "wagmi";
import { walletConnect } from "@wagmi/walletconnect-connector";
import { base, baseSepolia, hardhat, mainnet, polygon, polygonAmoy, sepolia } from "wagmi/chains";
import { chains, type SupportedChainId } from "./chains";

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

function rpcOverrides(): Record<string, string> {
  try {
    const parsed = JSON.parse(process.env.NEXT_PUBLIC_RPC_URLS || "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const nonEmpty = (value: string | undefined) => (value && value.trim().length > 0 ? value.trim() : undefined);

const NAMED_RPC: Partial<Record<number, string | undefined>> = {
  [hardhat.id]: nonEmpty(process.env.NEXT_PUBLIC_LOCAL_RPC_URL) ?? "http://127.0.0.1:8545",
  [polygon.id]: nonEmpty(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
  [polygonAmoy.id]: nonEmpty(process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL),
  [sepolia.id]: nonEmpty(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  [baseSepolia.id]: nonEmpty(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  [mainnet.id]: nonEmpty(process.env.NEXT_PUBLIC_MAINNET_RPC_URL),
  [base.id]: nonEmpty(process.env.NEXT_PUBLIC_BASE_RPC_URL),
};

const BACKUP_RPC: Partial<Record<number, string[]>> = {
  [polygon.id]: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"],
  [polygonAmoy.id]: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.drpc.org"],
};

const overrides = rpcOverrides();

function transportFor(chainId: number): Transport {
  const configured = nonEmpty(overrides[String(chainId)]) ?? NAMED_RPC[chainId];
  const backups = BACKUP_RPC[chainId];
  if (!backups) return http(configured);
  const urls = [...new Set([...(configured ? [configured] : []), ...backups])];
  return fallback(urls.map((url) => http(url)));
}

const transports = Object.fromEntries(chains.map((chain) => [chain.id, transportFor(chain.id)])) as Record<
  SupportedChainId,
  Transport
>;

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    injected({ shimDisconnect: true }),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
            metadata: {
              name: "CryptoLock",
              description: "Lock your crypto, your NFTs or your wallet for a fixed period, on-chain.",
              url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
