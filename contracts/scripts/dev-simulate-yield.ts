import { ethers } from "hardhat";
import { readDeployment } from "./lib/deployment-file";

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) throw new Error("This script only runs on the local development network.");
  const percent = Number(process.env.PERCENT ?? "1");
  const deployment = readDeployment(chainId);
  const [signer] = await ethers.getSigners();

  for (const token of deployment.tokens.filter((t) => t.kind === "vault")) {
    const vault = await ethers.getContractAt("MockYieldVault", token.address);
    const totalAssets = await vault.totalAssets();
    const amount = (totalAssets * BigInt(Math.round(percent * 100))) / 10_000n;
    if (amount === 0n) {
      console.log(`${token.symbol}: empty vault, nothing to do`);
      continue;
    }
    if (token.underlying!.toLowerCase() === deployment.wrappedNative.toLowerCase()) {
      const weth = await ethers.getContractAt("MockWETH", deployment.wrappedNative);
      await (await weth.connect(signer).deposit({ value: amount })).wait();
      await (await weth.connect(signer).transfer(token.address, amount)).wait();
    } else {
      const underlying = await ethers.getContractAt("MockERC20", token.underlying!);
      await (await underlying.mint(token.address, amount)).wait();
    }
    console.log(`${token.symbol}: +${percent}% (${ethers.formatUnits(amount, token.decimals)} added to the vault)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
