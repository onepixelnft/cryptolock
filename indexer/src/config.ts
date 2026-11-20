import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const PROTOCOL_VERSION = 3;

export interface Deployment {
  chainId: number;
  name: string;
  protocolVersion?: number;
  isLocal: boolean;
  deployBlock: number;
  contracts: { protocolConfig: Address; lockVault: Address; accountFactory: Address; nftLockVault?: Address };
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export const config = {
  port: number("PORT", 4000),
  host: process.env.HOST ?? "127.0.0.1",
  dbPath: path.resolve(ROOT, process.env.DB_PATH ?? "data/indexer.db"),
  deploymentsPath: path.resolve(ROOT, process.env.DEPLOYMENTS_PATH ?? "deployments.json"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  pollIntervalMs: number("POLL_INTERVAL_MS", 4_000),
  batchBlocks: number("BATCH_BLOCKS", 2_000),
  confirmations: number("CONFIRMATIONS", 2),
  signatureMaxAgeMs: number("SIGNATURE_MAX_AGE_MS", 10 * 60_000),
  rateLimitPerMinute: number("RATE_LIMIT_PER_MINUTE", 240),
  writeRateLimitPerMinute: number("WRITE_RATE_LIMIT_PER_MINUTE", 12),
  maxActivityEvents: number("MAX_ACTIVITY_EVENTS", 2_000),
  trustProxy: process.env.TRUST_PROXY === "true",
};

const DEFAULT_RPC: Record<number, string> = {
  31337: "http://127.0.0.1:8545",
  137: "https://polygon-bor-rpc.publicnode.com",
};

export function rpcUrl(chainId: number): string | undefined {
  const fromEnv = process.env[`RPC_URL_${chainId}`]?.trim();
  return fromEnv || DEFAULT_RPC[chainId];
}

const DEFAULT_CONFIRMATIONS: Record<number, number> = { 137: 16 };
export function confirmationsFor(chainId: number, isLocal: boolean): number {
  if (isLocal) return 0;
  if (process.env.CONFIRMATIONS !== undefined && process.env.CONFIRMATIONS !== "") return config.confirmations;
  return DEFAULT_CONFIRMATIONS[chainId] ?? config.confirmations;
}

export const skipLocal = process.env.INDEXER_SKIP_LOCAL === "true";

export function loadDeployments(): Deployment[] {
  if (!fs.existsSync(config.deploymentsPath)) return [];
  const raw = JSON.parse(fs.readFileSync(config.deploymentsPath, "utf8")) as Record<string, Deployment>;
  return Object.values(raw);
}
