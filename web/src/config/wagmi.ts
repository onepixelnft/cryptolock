import { createConfig, fallback, http, injected, type Transport } from "wagmi";
import { walletConnect } from "@wagmi/walletconnect-connector";
import { polygon } from "wagmi/chains";
import { chains, type SupportedChainId } from "./chains";

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const nonEmpty = (value: string | undefined) => (value && value.trim().length > 0 ? value.trim() : undefined);

const appUrl = nonEmpty(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000";

const POLYGON_RPC = [
  nonEmpty(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
].filter((url): url is string => !!url);

function transportFor(chainId: number): Transport {
  if (chainId === polygon.id) return fallback([...new Set(POLYGON_RPC)].map((url) => http(url)));
  return http(nonEmpty(process.env.NEXT_PUBLIC_LOCAL_RPC_URL) ?? "http://127.0.0.1:8545");
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
              description: "Lock your crypto, your NFTs or your wallet for a fixed period, on Polygon.",
              url: appUrl,
              icons: [`${appUrl.replace(/\/$/, "")}/apple-icon.png`],
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
