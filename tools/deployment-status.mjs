import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chainId = process.argv[2];
const versionSource = fs.readFileSync(path.join(root, "web", "src", "config", "deployments.ts"), "utf8");
const current = Number(/export const PROTOCOL_VERSION = (\d+)/.exec(versionSource)?.[1]);
const file = path.join(root, "web", "src", "config", "deployments.json");
const deployments = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const deployment = deployments[chainId];

if (!deployment) process.exit(2);
if ((deployment.protocolVersion ?? 1) !== current) process.exit(3);
console.log(`  ${deployment.name}: LockVault ${deployment.contracts.lockVault} (contracts v${current})`);
process.exit(0);
