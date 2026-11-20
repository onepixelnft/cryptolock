import { ethers, network } from "hardhat";

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) throw new Error("This script only runs on the local development network.");
  const days = Number(process.env.DAYS ?? "1");
  if (!Number.isFinite(days) || days <= 0) throw new Error("DAYS must be a positive number");

  await network.provider.send("evm_increaseTime", [Math.round(days * 86_400)]);
  await network.provider.send("evm_mine", []);
  const block = await ethers.provider.getBlock("latest");
  console.log(`Advanced ${days} day(s). Local chain time is now ${new Date(Number(block!.timestamp) * 1000).toISOString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
