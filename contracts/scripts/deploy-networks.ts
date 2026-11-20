import { spawnSync } from "node:child_process";
import hre from "hardhat";
import { createPublicClient, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type LiveNetworkConfig, PRIMARY_NETWORK_KEY, PRIMARY_TESTNET_KEY, findNetwork, orderedNetworks } from "./networks";
import { PROTOCOL_VERSION, readDeployments, readPendingDeployment } from "./lib/deployment-file";

const DEPLOY_GAS = 11_500_000n;
const PRICE_MARGIN_PERCENT = 130n;
const CONCURRENCY = 10;
const RESUME_VARIABLES = ["RESUME_PROTOCOL_CONFIG", "RESUME_LOCK_VAULT", "RESUME_ACCOUNT_FACTORY", "RESUME_NFT_LOCK_VAULT"];

type Decision = "deploy" | "current" | "empty" | "low" | "rpc";

interface Row {
  net: LiveNetworkConfig;
  number: number;
  state: string;
  balance?: bigint;
  cost?: bigint;
  decision: Decision;
  note?: string;
}

function label(net: LiveNetworkConfig): string {
  if (net.key === PRIMARY_NETWORK_KEY) return `${net.chain.name} (main network)`;
  if (net.key === PRIMARY_TESTNET_KEY) return `${net.chain.name} (main network testnet)`;
  return net.chain.name;
}

function amount(value: bigint | undefined, net: LiveNetworkConfig): string {
  if (value === undefined) return "-";
  const n = Number(formatUnits(value, net.chain.nativeCurrency.decimals));
  const text =
    n >= 1
      ? n.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
      : n.toLocaleString("en-US", { maximumSignificantDigits: 3, useGrouping: false });
  return `${text} ${net.chain.nativeCurrency.symbol}`;
}

function selectTargets(target: string): LiveNetworkConfig[] {
  const all = orderedNetworks();
  switch (target.toLowerCase()) {
    case "testnets":
      return all.filter((n) => n.chain.testnet);
    case "mainnets":
      return all.filter((n) => !n.chain.testnet);
    case "all":
      return all;
    default: {
      const net = findNetwork(target);
      if (!net) throw new Error(`Unknown network "${target}". See the list: npm run networks`);
      return [net];
    }
  }
}

function deployerAddress(): `0x${string}` {
  const accounts = (hre.config.networks[PRIMARY_NETWORK_KEY] as { accounts?: unknown }).accounts;
  const key = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0].trim() : "";
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is missing in contracts/.env (use a dedicated deployment wallet, never your main one).");
  try {
    return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`).address;
  } catch {
    throw new Error("DEPLOYER_PRIVATE_KEY in contracts/.env is not a valid private key (64 hexadecimal characters).");
  }
}

async function inspect(net: LiveNetworkConfig, number: number, deployer: `0x${string}`, single: boolean, force: boolean): Promise<Row> {
  const deployed = readDeployments()[String(net.chain.id)];
  const pending = readPendingDeployment(net.chain.id);
  const state = pending
    ? "interrupted deployment (resume)"
    : !deployed
      ? "not deployed"
      : deployed.protocolVersion === PROTOCOL_VERSION
        ? `up to date (v${PROTOCOL_VERSION})`
        : `old version (v${deployed.protocolVersion ?? 1}) -> upgrade`;
  if (!pending && deployed?.protocolVersion === PROTOCOL_VERSION && !force) {
    return { net, number, state, decision: "current" };
  }

  const url = (hre.config.networks[net.key] as { url?: string }).url;
  try {
    const client = createPublicClient({ transport: http(url, { timeout: 15_000, retryCount: 1 }) });
    const chainId = await client.getChainId();
    if (chainId !== net.chain.id) return { net, number, state, decision: "rpc", note: `the RPC answers for chain ${chainId}` };
    const [balance, gasPrice] = await Promise.all([client.getBalance({ address: deployer }), client.getGasPrice()]);
    const cost = (DEPLOY_GAS * gasPrice * PRICE_MARGIN_PERCENT) / 100n;
    if (balance === 0n) return { net, number, state, balance, cost, decision: "empty" };
    if (balance < cost) {
      return single
        ? { net, number, state, balance, cost, decision: "deploy", note: "balance may be too low" }
        : { net, number, state, balance, cost, decision: "low" };
    }
    return { net, number, state, balance, cost, decision: "deploy" };
  } catch {
    return { net, number, state, decision: "rpc", note: `set RPC_URL_${net.chain.id} in contracts/.env` };
  }
}

async function inspectAll(targets: LiveNetworkConfig[], deployer: `0x${string}`, force: boolean): Promise<Row[]> {
  const numbers = new Map(orderedNetworks().map((n, i) => [n.key, i + 1]));
  const rows: Row[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    rows.push(...(await Promise.all(batch.map((n) => inspect(n, numbers.get(n.key)!, deployer, targets.length === 1, force)))));
  }
  return rows;
}

const ACTION: Record<Decision, string> = {
  deploy: "TO DEPLOY",
  current: "skipped: already up to date",
  empty: "skipped: no funds for gas",
  low: "skipped: not enough funds",
  rpc: "skipped: RPC unreachable",
};

function printPlan(rows: Row[], deployer: string) {
  console.log(`\nDeployment account: ${deployer}`);
  console.log(`Estimated cost: ${Number(DEPLOY_GAS) / 1e6} M gas at the current network gas price, +30% margin.\n`);
  console.log(`${"#".padEnd(4)}${"Network".padEnd(38)}${"Balance".padEnd(22)}${"Estimated cost".padEnd(22)}${"State".padEnd(38)}Action`);
  for (const row of rows) {
    const action = ACTION[row.decision] + (row.note ? ` (${row.note})` : "");
    console.log(
      `${String(row.number).padEnd(4)}${label(row.net).slice(0, 37).padEnd(38)}${amount(row.balance, row.net).padEnd(22)}` +
        `${(row.cost === undefined ? "-" : `~ ${amount(row.cost, row.net)}`).padEnd(22)}${row.state.padEnd(38)}${action}`,
    );
  }
  const todo = rows.filter((r) => r.decision === "deploy");
  console.log(`\n${todo.length} network(s) to deploy out of ${rows.length}.`);
  if (rows.some((r) => r.decision === "empty" || r.decision === "low")) {
    console.log("For a network without funds: send its coin to the deployment account (free faucet for a testnet).");
  }
  if (rows.some((r) => r.decision === "current")) {
    console.log('Network already up to date: to redeploy anyway (new, empty contracts), "set FORCE_REDEPLOY=true" and run again.');
  }
}

function deployOne(net: LiveNetworkConfig, group: boolean, force: boolean): boolean {
  console.log(`\n${"=".repeat(78)}\n  ${label(net)} - chain ${net.chain.id}\n${"=".repeat(78)}`);
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_REDEPLOY: force ? "true" : "" };
  if (group) for (const name of RESUME_VARIABLES) env[name] = "";
  const result = spawnSync("npx", ["hardhat", "run", "scripts/deploy.ts", "--network", net.key], {
    cwd: hre.config.paths.root,
    env,
    stdio: "inherit",
    shell: true,
  });
  return result.status === 0;
}

async function main() {
  const target = process.env.DEPLOY_TARGET?.trim();
  if (!target) throw new Error("DEPLOY_TARGET is missing: a network key or number, testnets, mainnets or all.");
  const mode = (process.env.DEPLOY_MODE ?? "plan").trim().toLowerCase();
  const force = process.env.FORCE_REDEPLOY === "true";
  const targets = selectTargets(target);
  const deployer = deployerAddress();

  console.log(`Checking ${targets.length} network(s)...`);
  const rows = await inspectAll(targets, deployer, force);
  printPlan(rows, deployer);
  const todo = rows.filter((r) => r.decision === "deploy");
  if (todo.length === 0) {
    process.exitCode = 3;
    return;
  }
  if (mode !== "run") {
    if (todo.some((r) => !r.net.chain.testnet)) process.exitCode = 4;
    return;
  }

  const mainnets = todo.filter((r) => !r.net.chain.testnet);
  if (mainnets.length > 0 && process.env.DEPLOY_MAINNETS_CONFIRMED !== "true") {
    throw new Error(
      `Deployment on ${mainnets.map((r) => r.net.chain.name).join(", ")} (real coins) not confirmed: ` +
        "DEPLOY_MAINNETS_CONFIRMED=true is required.",
    );
  }

  const done: string[] = [];
  const failed: string[] = [];
  for (const row of todo) {
    (deployOne(row.net, targets.length > 1, force) ? done : failed).push(label(row.net));
  }
  console.log(`\n${"=".repeat(78)}`);
  console.log(`Deployed: ${done.length ? done.join(", ") : "none"}`);
  if (failed.length) {
    console.log(`Failed:   ${failed.join(", ")}`);
    console.log("Run the same option again: every interrupted deployment resumes where it stopped.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
