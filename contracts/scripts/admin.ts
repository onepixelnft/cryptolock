import { ethers } from "hardhat";
import { LIVE_NETWORKS } from "./networks";
import { readDeployments } from "./lib/deployment-file";

const configAbi = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function treasury() view returns (address)",
  "function earlyUnlockFeeTerms() view returns (uint16, uint16)",
  "function MAX_FEE_CAP_BPS() view returns (uint16)",
  "function setTreasury(address)",
  "function setEarlyUnlockFee(uint16, uint16)",
  "function transferOwnership(address)",
  "function acceptOwnership()",
];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const percent = (bps: number) => `${bps / 100}%`;

function envAddress(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!ethers.isAddress(raw) || same(raw, ethers.ZeroAddress)) throw new Error(`${name}: "${raw}" is not a valid address.`);
  return ethers.getAddress(raw);
}

function envBps(name: string, cap: number): number | undefined {
  const raw = process.env[name]?.trim().replace(",", ".").replace("%", "");
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value * 100 > cap) throw new Error(`${name}: "${raw}" must be a percentage between 0 and ${cap / 100}.`);
  return Math.round(value * 100);
}

async function main() {
  const action = (process.env.ADMIN_ACTION ?? "plan").trim().toLowerCase();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = readDeployments()[String(chainId)];
  if (!deployment) throw new Error(`CryptoLock is not deployed on chain ${chainId}.`);
  const explorer = LIVE_NETWORKS[chainId]?.chain.blockExplorers?.default.url;
  const configAddress = deployment.contracts.protocolConfig;
  const config = new ethers.Contract(configAddress, configAbi, ethers.provider);

  const [owner, pendingOwner, treasury, fees, cap] = await Promise.all([
    config.owner() as Promise<string>,
    config.pendingOwner() as Promise<string>,
    config.treasury() as Promise<string>,
    config.earlyUnlockFeeTerms() as Promise<[bigint, bigint]>,
    config.MAX_FEE_CAP_BPS() as Promise<bigint>,
  ]);
  const [minFee, maxFee] = [Number(fees[0]), Number(fees[1])];
  const signers = await ethers.getSigners();

  console.log(`${deployment.name} - ProtocolConfig ${configAddress}`);
  console.log(`  owner           ${owner}`);
  console.log(`  pending owner   ${same(pendingOwner, ethers.ZeroAddress) ? "none" : pendingOwner}`);
  console.log(`  treasury        ${treasury}`);
  console.log(`  early unlock    ${percent(maxFee)} right after locking -> ${percent(minFee)} just before the end`);
  console.log(`  key in .env     ${signers[0]?.address ?? "none"}\n`);

  const send = async (label: string, run: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) => {
    const tx = await run();
    console.log(`  ${label}: ${explorer ? `${explorer}/tx/${tx.hash}` : tx.hash}`);
    await tx.wait();
  };

  if (action === "accept") {
    if (same(pendingOwner, ethers.ZeroAddress)) throw new Error("No ownership transfer is waiting to be accepted.");
    const signer = signers.find((s) => same(s.address, pendingOwner));
    if (!signer) {
      throw new Error(`The key in contracts/.env is not the key of the new owner ${pendingOwner}. Put that key in DEPLOYER_PRIVATE_KEY, then run again.`);
    }
    await send("ownership accepted", () => (config.connect(signer) as any).acceptOwnership());
    console.log(`\nDone: ${pendingOwner} now owns the protocol.`);
    return;
  }

  const newOwner = envAddress("ADMIN_NEW_OWNER");
  const newTreasury = envAddress("ADMIN_NEW_TREASURY");
  const nextMax = envBps("ADMIN_MAX_FEE_PERCENT", Number(cap)) ?? maxFee;
  const nextMin = envBps("ADMIN_MIN_FEE_PERCENT", Number(cap)) ?? minFee;
  if (nextMin > nextMax) throw new Error("The fee just before the end cannot be higher than the fee right after locking.");

  const changes: string[] = [];
  const treasuryChange = !!newTreasury && !same(newTreasury, treasury);
  const feeChange = nextMin !== minFee || nextMax !== maxFee;
  const ownerChange = !!newOwner && !same(newOwner, owner) && !same(newOwner, pendingOwner);
  if (treasuryChange) changes.push(`treasury -> ${newTreasury}`);
  if (feeChange) changes.push(`early unlock -> ${percent(nextMax)} right after locking, ${percent(nextMin)} just before the end (new locks only)`);
  if (ownerChange) changes.push(`ownership -> ${newOwner} (it must then accept)`);
  if (changes.length === 0) {
    console.log("Nothing to change.");
    process.exitCode = 3;
    return;
  }
  console.log("Planned changes:");
  for (const change of changes) console.log(`  - ${change}`);
  if (action !== "apply") return;

  const signer = signers.find((s) => same(s.address, owner));
  if (!signer) throw new Error(`The key in contracts/.env is not the key of the current owner ${owner}.`);
  const admin = config.connect(signer) as any;
  console.log("");
  if (treasuryChange) await send("treasury updated", () => admin.setTreasury(newTreasury));
  if (feeChange) await send("early-unlock fee updated", () => admin.setEarlyUnlockFee(nextMin, nextMax));
  if (ownerChange) {
    await send("ownership transfer started", () => admin.transferOwnership(newOwner));
    console.log(`\nNext step: ${newOwner} must accept the ownership (lancer.bat, option 5).`);
  }
  console.log("\nDone.");
}

main().catch((error) => {
  console.error(`\n[ERROR] ${error?.shortMessage ?? error?.message ?? String(error)}`);
  process.exitCode = 1;
});
