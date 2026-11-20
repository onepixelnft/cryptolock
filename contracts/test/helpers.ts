import { ethers } from "hardhat";

export const DAY = 24 * 60 * 60;
export const MIN_FEE_BPS = 100n;
export const MAX_FEE_BPS = 500n;
export const MIN_DURATION = 60;
export const MAX_DURATION = 3650 * DAY;

export const usdc = (value: number | bigint) => BigInt(value) * 10n ** 6n;
export const eth = (value: string) => ethers.parseEther(value);

export function expectedFeeBps(minBps: bigint, maxBps: bigint, start: bigint, end: bigint, t: bigint): bigint {
  if (t >= end) return 0n;
  const from = t > start ? t : start;
  return minBps + ((maxBps - minBps) * (end - from)) / (end - start);
}

export async function deployProtocol() {
  const [admin, treasury, alice, bob, spender, recovery] = await ethers.getSigners();

  const weth = await ethers.deployContract("MockWETH");
  const usdcToken = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const dai = await ethers.deployContract("MockERC20", ["Dai Stablecoin", "DAI", 18]);
  const unlisted = await ethers.deployContract("MockERC20", ["Unlisted Token", "UNL", 18]);
  await Promise.all([weth, usdcToken, dai, unlisted].map((c) => c.waitForDeployment()));

  const config = await ethers.deployContract("ProtocolConfig", [
    admin.address,
    treasury.address,
    await weth.getAddress(),
    MIN_FEE_BPS,
    MAX_FEE_BPS,
    MIN_DURATION,
    MAX_DURATION,
  ]);
  await config.waitForDeployment();

  const vault = await ethers.deployContract("LockVault", [await config.getAddress(), ethers.ZeroAddress]);
  const factory = await ethers.deployContract("LockableAccountFactory", [await config.getAddress()]);
  const usdcVault = await ethers.deployContract("MockYieldVault", [await usdcToken.getAddress(), "Staked USDC", "sUSDC"]);
  const wethVault = await ethers.deployContract("MockYieldVault", [await weth.getAddress(), "Staked WETH", "sWETH"]);
  await Promise.all([vault, factory, usdcVault, wethVault].map((c) => c.waitForDeployment()));

  await config.setStakingVault(await usdcToken.getAddress(), await usdcVault.getAddress());
  await config.setStakingVault(ethers.ZeroAddress, await wethVault.getAddress());
  await config.publishFeeAssetList([
    await usdcToken.getAddress(),
    await dai.getAddress(),
    await weth.getAddress(),
    await usdcVault.getAddress(),
    await wethVault.getAddress(),
  ]);

  for (const user of [alice, bob]) {
    await usdcToken.mint(user.address, usdc(1_000_000));
    await dai.mint(user.address, eth("1000000"));
    await unlisted.mint(user.address, eth("1000000"));
  }

  return {
    admin,
    treasury,
    alice,
    bob,
    spender,
    recovery,
    weth,
    usdc: usdcToken,
    dai,
    unlisted,
    config,
    vault,
    factory,
    usdcVault,
    wethVault,
  };
}
