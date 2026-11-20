import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { DAY, deployProtocol } from "./helpers";

describe("ProtocolConfig", () => {
  it("exposes the initial terms", async () => {
    const { config, treasury, weth } = await loadFixture(deployProtocol);
    expect(await config.treasury()).to.equal(treasury.address);
    expect(await config.wrappedNative()).to.equal(await weth.getAddress());
    const [minFee, maxFee] = await config.earlyUnlockFeeTerms();
    expect(minFee).to.equal(100n);
    expect(maxFee).to.equal(500n);
    expect(await config.currentFeeAssetListVersion()).to.equal(1n);
    expect(await config.feeAssets(0)).to.deep.equal([]);
  });

  it("enforces the immutable fee cap and a coherent fee range", async () => {
    const { config } = await loadFixture(deployProtocol);
    await expect(config.setEarlyUnlockFee(100, 2_001)).to.be.revertedWithCustomError(config, "InvalidFeeRange");
    await expect(config.setEarlyUnlockFee(600, 500)).to.be.revertedWithCustomError(config, "InvalidFeeRange");
    await expect(config.setEarlyUnlockFee(0, 2_000)).to.emit(config, "EarlyUnlockFeeUpdated").withArgs(0, 2_000);
  });

  it("enforces the immutable duration bounds", async () => {
    const { config } = await loadFixture(deployProtocol);
    await expect(config.setLockDurationLimits(59, DAY)).to.be.revertedWithCustomError(config, "InvalidDurationRange");
    await expect(config.setLockDurationLimits(60, 7301 * DAY)).to.be.revertedWithCustomError(
      config,
      "InvalidDurationRange",
    );
    await expect(config.setLockDurationLimits(2 * DAY, DAY)).to.be.revertedWithCustomError(
      config,
      "InvalidDurationRange",
    );
  });

  it("validates unlock times against the limits", async () => {
    const { config } = await loadFixture(deployProtocol);
    const now = await time.latest();
    await expect(config.checkUnlockTime(now - 1)).to.be.revertedWithCustomError(config, "LockDurationOutOfRange");
    await expect(config.checkUnlockTime(now + 30)).to.be.revertedWithCustomError(config, "LockDurationOutOfRange");
    await expect(config.checkUnlockTime(now + 3651 * DAY)).to.be.revertedWithCustomError(
      config,
      "LockDurationOutOfRange",
    );
    await config.checkUnlockTime(now + 7 * DAY);
  });

  it("only accepts ERC-4626 staking vaults whose asset matches the token", async () => {
    const { config, usdc, dai, usdcVault, wethVault, alice } = await loadFixture(deployProtocol);
    await expect(config.setStakingVault(await dai.getAddress(), await usdcVault.getAddress()))
      .to.be.revertedWithCustomError(config, "VaultAssetMismatch");
    await expect(config.setStakingVault(await usdc.getAddress(), await wethVault.getAddress()))
      .to.be.revertedWithCustomError(config, "VaultAssetMismatch");
    await expect(config.setStakingVault(await usdc.getAddress(), alice.address))
      .to.be.revertedWithCustomError(config, "NotAContract");
    await expect(config.setStakingVault(await usdc.getAddress(), ethers.ZeroAddress))
      .to.emit(config, "StakingVaultUpdated")
      .withArgs(await usdc.getAddress(), ethers.ZeroAddress);
  });

  it("refuses native staking when the chain has no wrapped native coin", async () => {
    const [admin, treasury] = await ethers.getSigners();
    const config = await ethers.deployContract("ProtocolConfig", [
      admin.address,
      treasury.address,
      ethers.ZeroAddress,
      100,
      500,
      60,
      365 * DAY,
    ]);
    const weth = await ethers.deployContract("MockWETH");
    const vault = await ethers.deployContract("MockYieldVault", [await weth.getAddress(), "v", "v"]);
    await expect(config.setStakingVault(ethers.ZeroAddress, await vault.getAddress())).to.be.revertedWithCustomError(
      config,
      "WrappedNativeUnavailable",
    );
  });

  it("publishes immutable, validated fee asset lists", async () => {
    const { config, usdc, dai, alice } = await loadFixture(deployProtocol);
    const usdcAddr = await usdc.getAddress();
    const daiAddr = await dai.getAddress();
    await expect(config.publishFeeAssetList([usdcAddr, usdcAddr])).to.be.revertedWithCustomError(
      config,
      "DuplicateFeeAsset",
    );
    await expect(config.publishFeeAssetList([alice.address])).to.be.revertedWithCustomError(config, "NotAContract");
    await expect(config.publishFeeAssetList([ethers.ZeroAddress])).to.be.revertedWithCustomError(
      config,
      "ZeroAddress",
    );
    const tooMany = Array.from({ length: 33 }, () => usdcAddr);
    await expect(config.publishFeeAssetList(tooMany)).to.be.revertedWithCustomError(config, "TooManyFeeAssets");

    const before = await config.feeAssets(1);
    await config.publishFeeAssetList([daiAddr]);
    expect(await config.currentFeeAssetListVersion()).to.equal(2n);
    expect(await config.feeAssets(2)).to.deep.equal([daiAddr]);
    expect(await config.feeAssets(1)).to.deep.equal(before);
    await expect(config.feeAssets(3)).to.be.revertedWithCustomError(config, "UnknownFeeAssetList");
  });

  it("restricts administration to the owner, with a two-step transfer", async () => {
    const { config, alice, bob } = await loadFixture(deployProtocol);
    await expect(config.connect(alice).setTreasury(alice.address)).to.be.revertedWithCustomError(
      config,
      "OwnableUnauthorizedAccount",
    );
    await config.transferOwnership(bob.address);
    expect(await config.pendingOwner()).to.equal(bob.address);
    await config.connect(bob).acceptOwnership();
    expect(await config.owner()).to.equal(bob.address);
  });
});
