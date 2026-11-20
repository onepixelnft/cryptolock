import fs from "node:fs";
import path from "node:path";

export interface DeployedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceFeed?: string;
  kind: "token" | "vault";
  underlying?: string;
}

export interface DeployedNftCollection {
  address: string;
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
  protocolVersion: number;
  isLocal: boolean;
  deployBlock: number;
  deployedAt: string;
  contracts: {
    protocolConfig: string;
    lockVault: string;
    accountFactory: string;
    nftLockVault?: string;
  };
  wrappedNative: string;
  native: { symbol: string; name: string; decimals: number; priceFeed?: string };
  tokens: DeployedToken[];
  nftCollections?: DeployedNftCollection[];
  devUnlistedTokens?: string[];
}

const CONTRACTS_ROOT = path.resolve(__dirname, "..", "..");
const PROJECT_ROOT = path.resolve(CONTRACTS_ROOT, "..");

const TARGETS = [
  { packageDir: CONTRACTS_ROOT, file: path.join(CONTRACTS_ROOT, "deployments", "deployments.json") },
  { packageDir: path.join(PROJECT_ROOT, "web"), file: path.join(PROJECT_ROOT, "web", "src", "config", "deployments.json") },
  { packageDir: path.join(PROJECT_ROOT, "indexer"), file: path.join(PROJECT_ROOT, "indexer", "deployments.json") },
];

export function writeDeployment(deployment: Deployment) {
  for (const { packageDir, file } of TARGETS) {
    if (!fs.existsSync(packageDir)) {
      console.warn(`  skipped ${file} (package not found)`);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current: Record<string, Deployment> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    current[String(deployment.chainId)] = deployment;
    fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
    console.log(`  wrote ${path.relative(PROJECT_ROOT, file)}`);
  }
}

export function readDeployments(): Record<string, Deployment> {
  const file = TARGETS[0].file;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

export function readDeployment(chainId: number): Deployment {
  if (!fs.existsSync(TARGETS[0].file)) throw new Error(`No deployment file at ${TARGETS[0].file}. Run the deploy script first.`);
  const deployment = readDeployments()[String(chainId)];
  if (!deployment) throw new Error(`No deployment for chain ${chainId}.`);
  return deployment;
}

export interface PendingDeployment {
  chainId: number;
  protocolVersion: number;
  deployer: string;
  deployBlock: number;
  updatedAt: string;
  protocolConfig?: string;
  lockVault?: string;
  accountFactory?: string;
  nftLockVault?: string;
}

const PENDING_DIR = path.join(CONTRACTS_ROOT, "deployments", "pending");
const pendingFile = (chainId: number) => path.join(PENDING_DIR, `${chainId}.json`);

export function readPendingDeployment(chainId: number): PendingDeployment | undefined {
  const file = pendingFile(chainId);
  if (!fs.existsSync(file)) return undefined;
  try {
    const pending = JSON.parse(fs.readFileSync(file, "utf8")) as PendingDeployment;
    return pending.chainId === chainId ? pending : undefined;
  } catch {
    return undefined;
  }
}

export function writePendingDeployment(pending: PendingDeployment) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  fs.writeFileSync(pendingFile(pending.chainId), JSON.stringify(pending, null, 2) + "\n");
}

export function clearPendingDeployment(chainId: number) {
  fs.rmSync(pendingFile(chainId), { force: true });
}
