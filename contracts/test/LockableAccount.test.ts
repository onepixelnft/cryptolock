import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { DAY, MAX_FEE_BPS, MIN_FEE_BPS, deployProtocol, eth, usdc } from "./helpers";

const DAYS = (n: number) => BigInt(n * DAY);
const TERMS = [MIN_FEE_BPS, MAX_FEE_BPS, 1n] as const;
const LockStatus = { None: 0n, Active: 1n, EarlyUnlocked: 2n, Completed: 3n };
const Kind = {
  Erc20Allowance: 0n,
  Erc721Token: 1n,
  OperatorForAll: 2n,
  Erc777Operator: 3n,
  Erc6909Operator: 4n,
  Erc6909Allowance: 5n,
};

async function accountFixture() {
  const fx = await deployProtocol();
  const predicted = await fx.factory.predictAddress(fx.alice.address, 0);

  await fx.alice.sendTransaction({ to: predicted, value: eth("10") });
  await fx.usdc.connect(fx.alice).transfer(predicted, usdc(5_000));
  await fx.dai.connect(fx.alice).transfer(predicted, eth("1000"));
  await fx.unlisted.connect(fx.alice).transfer(predicted, eth("1000"));

  await expect(fx.factory.createAccount(fx.alice.address, 0))
    .to.emit(fx.factory, "AccountCreated")
    .withArgs(predicted, fx.alice.address, 0);
  const account = await ethers.getContractAt("LockableAccount", predicted);
  return { ...fx, account };
}

async function lockAt(fx: Awaited<ReturnType<typeof accountFixture>>, days: number) {
  const start = BigInt(await time.latest()) + 10n;
  const end = start + DAYS(days);
  await time.setNextBlockTimestamp(start);
  await fx.account.connect(fx.alice).lock(end, [], ...TERMS);
  return { start, end };
}

describe("LockableAccount (Wallet Lock)", () => {
  describe("deployment", () => {
    it("is deployed at the predicted address, owned by the right wallet, with its funds", async () => {
      const fx = await loadFixture(accountFixture);
      expect(await fx.account.owner()).to.equal(fx.alice.address);
      expect(await ethers.provider.getBalance(fx.account)).to.equal(eth("10"));
      expect(await fx.usdc.balanceOf(fx.account)).to.equal(usdc(5_000));
      expect(await fx.account.isLocked()).to.equal(false);

      await expect(fx.factory.createAccount(fx.alice.address, 0)).not.to.emit(fx.factory, "AccountCreated");
      expect(await fx.factory.predictAddress(fx.bob.address, 0)).not.to.equal(await fx.account.getAddress());
    });

    it("cannot be re-initialised, and the implementation is unusable", async () => {
      const fx = await loadFixture(accountFixture);
      await expect(fx.account.connect(fx.bob).initialize(fx.bob.address)).to.be.revertedWithCustomError(
        fx.account,
        "NotFactory",
      );
      const implementation = await ethers.getContractAt("LockableAccount", await fx.factory.implementation());
      expect(await implementation.owner()).to.equal("0x000000000000000000000000000000000000dEaD");
      await expect(implementation.connect(fx.alice).execute(fx.bob.address, 0, "0x")).to.be.revertedWithCustomError(
        implementation,
        "NotOwner",
      );
    });
  });

  describe("while unlocked", () => {
    it("executes single and batched calls for its owner only", async () => {
      const fx = await loadFixture(accountFixture);
      await expect(fx.account.connect(fx.alice).execute(fx.bob.address, eth("1"), "0x")).to.changeEtherBalances(
        [fx.account, fx.bob],
        [-eth("1"), eth("1")],
      );

      const transfer = fx.usdc.interface.encodeFunctionData("transfer", [fx.bob.address, usdc(100)]);
      await expect(
        fx.account.connect(fx.alice).executeBatch([
          { target: fx.usdc, value: 0, data: transfer },
          { target: fx.bob.address, value: eth("0.5"), data: "0x" },
        ]),
      ).to.changeTokenBalance(fx.usdc, fx.bob, usdc(100));

      await expect(fx.account.connect(fx.bob).execute(fx.bob.address, 1, "0x")).to.be.revertedWithCustomError(
        fx.account,
        "NotOwner",
      );
      await expect(
        fx.account.connect(fx.alice).execute(fx.account, 0, fx.account.interface.encodeFunctionData("pruneApprovals")),
      ).to.be.revertedWithCustomError(fx.account, "SelfCallForbidden");
    });

    it("bubbles up the revert reason of a failed call", async () => {
      const fx = await loadFixture(accountFixture);
      const tooMuch = fx.usdc.interface.encodeFunctionData("transfer", [fx.bob.address, usdc(1_000_000)]);
      await expect(fx.account.connect(fx.alice).execute(fx.usdc, 0, tooMuch)).to.be.revertedWithCustomError(
        fx.usdc,
        "ERC20InsufficientBalance",
      );
    });

    it("transfers ownership in two steps", async () => {
      const fx = await loadFixture(accountFixture);
      await fx.account.connect(fx.alice).transferOwnership(fx.bob.address);
      await expect(fx.account.connect(fx.alice).acceptOwnership()).to.be.revertedWithCustomError(
        fx.account,
        "NotPendingOwner",
      );
      await fx.account.connect(fx.bob).acceptOwnership();
      expect(await fx.account.owner()).to.equal(fx.bob.address);
    });
  });

  describe("while locked", () => {
    it("blocks every outgoing operation and still receives assets", async () => {
      const fx = await loadFixture(accountFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS)).to.emit(fx.account, "WalletLocked");
      expect(await fx.account.isLocked()).to.equal(true);
      expect(await fx.account.lockedUntil()).to.equal(end);

      const transfer = fx.usdc.interface.encodeFunctionData("transfer", [fx.bob.address, 1]);
      await expect(fx.account.connect(fx.alice).execute(fx.bob.address, eth("1"), "0x"))
        .to.be.revertedWithCustomError(fx.account, "WalletIsLocked")
        .withArgs(end);
      await expect(fx.account.connect(fx.alice).execute(fx.usdc, 0, transfer)).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
      await expect(fx.account.connect(fx.alice).executeBatch([])).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
      await expect(fx.account.connect(fx.alice).transferOwnership(fx.bob.address)).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
      await expect(fx.account.connect(fx.alice).setRecovery(fx.bob.address, DAYS(3))).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
      await expect(fx.account.connect(fx.alice).lock(end + 1n, [], ...TERMS)).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
      await expect(fx.account.connect(fx.alice).completeLock()).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );

      const signature = await fx.alice.signMessage("anything");
      expect(await fx.account.isValidSignature(ethers.hashMessage("anything"), signature)).to.equal("0xffffffff");

      await expect(fx.bob.sendTransaction({ to: fx.account, value: eth("1") })).to.changeEtherBalance(
        fx.account,
        eth("1"),
      );
      await expect(fx.usdc.connect(fx.bob).transfer(fx.account, usdc(10))).to.changeTokenBalance(
        fx.usdc,
        fx.account,
        usdc(10),
      );
    });

    it("only starts with the fee terms and fee asset list the owner reviewed", async () => {
      const fx = await loadFixture(accountFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      expect(await fx.account.PROTOCOL_VERSION()).to.equal(3n);

      await fx.config.setEarlyUnlockFee(MIN_FEE_BPS + 1n, MAX_FEE_BPS);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "FeeTermsChanged")
        .withArgs(MIN_FEE_BPS + 1n, MAX_FEE_BPS);
      await fx.config.setEarlyUnlockFee(MIN_FEE_BPS, MAX_FEE_BPS);

      await fx.config.publishFeeAssetList([await fx.unlisted.getAddress()]);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "FeeAssetListChanged")
        .withArgs(1n, 2n);

      await expect(fx.account.connect(fx.alice).lock(end, [], MIN_FEE_BPS, MAX_FEE_BPS, 2n))
        .to.emit(fx.account, "WalletLocked")
        .withArgs(0, (v: bigint) => v > 0n, end, MIN_FEE_BPS, MAX_FEE_BPS, 2n);
      expect(await fx.account.isLocked()).to.equal(true);
    });

    it("lifts the restrictions automatically at the unlock time", async () => {
      const fx = await loadFixture(accountFixture);
      const { end } = await lockAt(fx, 30);
      await time.increaseTo(end);
      expect(await fx.account.isLocked()).to.equal(false);
      expect(await fx.account.lockedUntil()).to.equal(0n);
      await fx.account.connect(fx.alice).execute(fx.bob.address, eth("1"), "0x");

      const [record] = await fx.account.getLocks();
      expect(record.status).to.equal(LockStatus.Completed);

      await expect(fx.account.connect(fx.alice).completeLock()).to.emit(fx.account, "WalletLockCompleted").withArgs(0);
      await expect(fx.account.connect(fx.alice).completeLock()).to.be.revertedWithCustomError(
        fx.account,
        "NoActiveLock",
      );

      await fx.account.connect(fx.alice).lock(BigInt(await time.latest()) + DAYS(7), [], ...TERMS);
      expect(await fx.account.lockCount()).to.equal(2n);
    });
  });

  describe("approvals", () => {
    it("refuses to lock while an ERC-20 approval is live", async () => {
      const fx = await loadFixture(accountFixture);
      const usdcAddr = await fx.usdc.getAddress();
      const approve = fx.usdc.interface.encodeFunctionData("approve", [fx.spender.address, usdc(100)]);
      await expect(fx.account.connect(fx.alice).execute(fx.usdc, 0, approve))
        .to.emit(fx.account, "ApprovalTracked")
        .withArgs(usdcAddr, fx.spender.address, Kind.Erc20Allowance, 0);

      const [approvals, live] = await fx.account.trackedApprovals();
      expect(approvals.length).to.equal(1);
      expect(live[0]).to.equal(true);

      const end = BigInt(await time.latest()) + DAYS(30);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(usdcAddr, fx.spender.address, Kind.Erc20Allowance, 0);

      const revoke = fx.usdc.interface.encodeFunctionData("approve", [fx.spender.address, 0]);
      await expect(fx.account.connect(fx.alice).execute(fx.usdc, 0, revoke)).to.emit(fx.account, "ApprovalCleared");
      await fx.account.connect(fx.alice).lock(end, [], ...TERMS);
    });

    it("forgets approvals that were fully used, when the lock starts", async () => {
      const fx = await loadFixture(accountFixture);
      const approve = fx.usdc.interface.encodeFunctionData("approve", [fx.spender.address, usdc(100)]);
      await fx.account.connect(fx.alice).execute(fx.usdc, 0, approve);
      await fx.usdc.connect(fx.spender).transferFrom(fx.account, fx.spender.address, usdc(100));

      const end = BigInt(await time.latest()) + DAYS(30);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS)).to.emit(fx.account, "ApprovalCleared");
      const [approvals] = await fx.account.trackedApprovals();
      expect(approvals.length).to.equal(0);

      await expect(
        fx.usdc.connect(fx.spender).transferFrom(fx.account, fx.spender.address, 1),
      ).to.be.revertedWithCustomError(fx.usdc, "ERC20InsufficientAllowance");
    });

    it("tracks ERC-721 single-token and operator approvals", async () => {
      const fx = await loadFixture(accountFixture);
      const nft = await ethers.deployContract("MockERC721");
      const nftAddr = await nft.getAddress();
      await nft.mint(fx.account, 7);
      const end = BigInt(await time.latest()) + DAYS(30);

      await fx.account.connect(fx.alice).execute(nft, 0, nft.interface.encodeFunctionData("approve", [fx.spender.address, 7]));
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(nftAddr, fx.spender.address, Kind.Erc721Token, 7);
      await fx.account
        .connect(fx.alice)
        .execute(nft, 0, nft.interface.encodeFunctionData("approve", [ethers.ZeroAddress, 7]));

      await fx.account
        .connect(fx.alice)
        .execute(nft, 0, nft.interface.encodeFunctionData("setApprovalForAll", [fx.spender.address, true]));
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(nftAddr, fx.spender.address, Kind.OperatorForAll, 0);
      await expect(
        fx.account
          .connect(fx.alice)
          .execute(nft, 0, nft.interface.encodeFunctionData("setApprovalForAll", [fx.spender.address, false])),
      ).to.emit(fx.account, "ApprovalCleared");

      await fx.account.connect(fx.alice).lock(end, [], ...TERMS);
      await expect(
        nft.connect(fx.spender).transferFrom(fx.account, fx.spender.address, 7),
      ).to.be.revertedWithCustomError(nft, "ERC721InsufficientApproval");
    });

    it("detects approvals wrapped in a multicall, including nested ones", async () => {
      const fx = await loadFixture(accountFixture);
      const token = await ethers.deployContract("MockMulticallERC20");
      const tokenAddr = await token.getAddress();
      await token.mint(fx.account, eth("100"));
      const approve = token.interface.encodeFunctionData("approve", [fx.spender.address, eth("100")]);
      const nested = token.interface.encodeFunctionData("multicall", [
        [token.interface.encodeFunctionData("multicall", [[approve]])],
      ]);

      await expect(fx.account.connect(fx.alice).execute(token, 0, nested))
        .to.emit(fx.account, "ApprovalTracked")
        .withArgs(tokenAddr, fx.spender.address, Kind.Erc20Allowance, 0);
      expect(await token.allowance(fx.account, fx.spender.address)).to.equal(eth("100"));

      const end = BigInt(await time.latest()) + DAYS(30);
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(tokenAddr, fx.spender.address, Kind.Erc20Allowance, 0);

      const revoke = token.interface.encodeFunctionData("multicall", [
        [token.interface.encodeFunctionData("approve", [fx.spender.address, 0])],
      ]);
      await expect(fx.account.connect(fx.alice).execute(token, 0, revoke)).to.emit(fx.account, "ApprovalCleared");
      await fx.account.connect(fx.alice).lock(end, [], ...TERMS);
    });

    it("tracks ERC-6909 operators and per-id allowances", async () => {
      const fx = await loadFixture(accountFixture);
      const claims = await ethers.deployContract("MockERC6909");
      const claimsAddr = await claims.getAddress();
      const end = BigInt(await time.latest()) + DAYS(30);

      await fx.account
        .connect(fx.alice)
        .execute(claims, 0, claims.interface.encodeFunctionData("setOperator", [fx.spender.address, true]));
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(claimsAddr, fx.spender.address, Kind.Erc6909Operator, 0);
      await fx.account
        .connect(fx.alice)
        .execute(claims, 0, claims.interface.encodeFunctionData("setOperator", [fx.spender.address, false]));

      await fx.account
        .connect(fx.alice)
        .execute(claims, 0, claims.interface.encodeFunctionData("approve", [fx.spender.address, 42, 1_000]));
      await expect(fx.account.connect(fx.alice).lock(end, [], ...TERMS))
        .to.be.revertedWithCustomError(fx.account, "ApprovalStillActive")
        .withArgs(claimsAddr, fx.spender.address, Kind.Erc6909Allowance, 42);
      await fx.account
        .connect(fx.alice)
        .execute(claims, 0, claims.interface.encodeFunctionData("approve", [fx.spender.address, 42, 0]));

      await fx.account.connect(fx.alice).lock(end, [], ...TERMS);
    });

    it("rejects a malformed multicall payload instead of skipping its inspection", async () => {
      const fx = await loadFixture(accountFixture);
      const token = await ethers.deployContract("MockMulticallERC20");
      const selector = token.interface.getFunction("multicall")!.selector;
      const garbage = selector + "ff".repeat(8);
      expect(await ethers.provider.getCode(fx.bob.address)).to.equal("0x");
      await expect(fx.account.connect(fx.alice).execute(fx.bob.address, 0, garbage)).to.be.reverted;
      await fx.account.connect(fx.alice).execute(fx.bob.address, 0, "0x12345678" + "ff".repeat(8));
    });
  });

  describe("early unlock", () => {
    it("pays the fee on the native coin and every listed asset, then lifts the restrictions", async () => {
      const fx = await loadFixture(accountFixture);
      const { start } = await lockAt(fx, 90);

      await time.setNextBlockTimestamp(start + DAYS(45));
      const tx = await fx.account.connect(fx.alice).unlockEarly();
      await expect(tx).to.emit(fx.account, "WalletUnlockedEarly").withArgs(0, 300n);
      await expect(tx).to.changeEtherBalances([fx.account, fx.treasury], [-eth("0.3"), eth("0.3")]);
      await expect(tx).to.changeTokenBalances(fx.usdc, [fx.account, fx.treasury], [-usdc(150), usdc(150)]);
      await expect(tx).to.changeTokenBalances(fx.dai, [fx.account, fx.treasury], [-eth("30"), eth("30")]);
      await expect(tx).to.changeTokenBalance(fx.unlisted, fx.treasury, 0n);

      expect(await fx.account.isLocked()).to.equal(false);
      const [record] = await fx.account.getLocks();
      expect(record.status).to.equal(LockStatus.EarlyUnlocked);
      expect(record.feeBpsPaid).to.equal(300n);
      await fx.account.connect(fx.alice).execute(fx.bob.address, eth("1"), "0x");
      await expect(fx.account.connect(fx.alice).unlockEarly()).to.be.revertedWithCustomError(
        fx.account,
        "WalletNotLocked",
      );
    });

    it("previews the exact fee per asset", async () => {
      const fx = await loadFixture(accountFixture);
      const { start } = await lockAt(fx, 90);
      await time.increaseTo(start + DAYS(45) - 5n);
      const [feeBps, assets, balances, fees] = await fx.account.previewEarlyUnlock();
      expect(feeBps).to.be.closeTo(300n, 1n);
      expect(assets[0]).to.equal(ethers.ZeroAddress);
      expect(assets[1]).to.equal(await fx.usdc.getAddress());
      expect(balances[1]).to.equal(usdc(5_000));
      expect(fees[1]).to.equal((usdc(5_000) * feeBps) / 10_000n);
    });

    it("uses the fee asset list recorded when the lock started", async () => {
      const fx = await loadFixture(accountFixture);
      const { start } = await lockAt(fx, 90);
      await fx.config.publishFeeAssetList([await fx.unlisted.getAddress()]);

      await time.setNextBlockTimestamp(start + DAYS(45));
      const tx = await fx.account.connect(fx.alice).unlockEarly();
      await expect(tx).to.changeTokenBalance(fx.usdc, fx.treasury, usdc(150));
      await expect(tx).to.changeTokenBalance(fx.unlisted, fx.treasury, 0n);
    });

    it("can only be triggered by the owner", async () => {
      const fx = await loadFixture(accountFixture);
      await lockAt(fx, 30);
      await expect(fx.account.connect(fx.bob).unlockEarly()).to.be.revertedWithCustomError(fx.account, "NotOwner");
    });
  });

  describe("staking", () => {
    it("deposits eligible assets into whitelisted vaults when the lock starts", async () => {
      const fx = await loadFixture(accountFixture);
      const usdcAddr = await fx.usdc.getAddress();
      const usdcVaultAddr = await fx.usdcVault.getAddress();
      const wethVaultAddr = await fx.wethVault.getAddress();
      const end = BigInt(await time.latest()) + DAYS(30);

      const tx = fx.account.connect(fx.alice).lock(end, [
        { token: usdcAddr, vault: usdcVaultAddr, amount: usdc(1_000) },
        { token: ethers.ZeroAddress, vault: wethVaultAddr, amount: eth("2") },
      ], ...TERMS);
      await expect(tx)
        .to.emit(fx.account, "Staked")
        .withArgs(0, usdcAddr, usdcVaultAddr, usdc(1_000), usdc(1_000));
      expect(await fx.usdcVault.balanceOf(fx.account)).to.equal(usdc(1_000));
      expect(await fx.wethVault.balanceOf(fx.account)).to.equal(eth("2"));
      expect(await ethers.provider.getBalance(fx.account)).to.equal(eth("8"));
      expect(await fx.usdc.allowance(fx.account, fx.usdcVault)).to.equal(0n);
      expect((await fx.account.getLocks())[0].staked).to.equal(true);

      const accountAddr = await fx.account.getAddress();
      const redeem = fx.usdcVault.interface.encodeFunctionData("redeem", [usdc(1), accountAddr, accountAddr]);
      await expect(fx.account.connect(fx.alice).execute(fx.usdcVault, 0, redeem)).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
    });

    it("rejects vaults that are not whitelisted for the token", async () => {
      const fx = await loadFixture(accountFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      await expect(
        fx.account.connect(fx.alice).lock(end, [
          { token: await fx.dai.getAddress(), vault: await fx.usdcVault.getAddress(), amount: eth("1") },
        ], ...TERMS),
      ).to.be.revertedWithCustomError(fx.account, "InvalidStake");
      await expect(
        fx.account.connect(fx.alice).lock(end, [
          { token: await fx.usdc.getAddress(), vault: await fx.usdcVault.getAddress(), amount: 0 },
        ], ...TERMS),
      ).to.be.revertedWithCustomError(fx.account, "InvalidStake");
    });
  });

  describe("recovery", () => {
    it("changes the owner after the delay without ever ending the lock", async () => {
      const fx = await loadFixture(accountFixture);
      await expect(fx.account.connect(fx.alice).setRecovery(fx.recovery.address, DAYS(1)))
        .to.be.revertedWithCustomError(fx.account, "InvalidRecoveryDelay");
      await fx.account.connect(fx.alice).setRecovery(fx.recovery.address, DAYS(3));
      await lockAt(fx, 90);

      await expect(fx.account.connect(fx.bob).initiateRecovery(fx.bob.address)).to.be.revertedWithCustomError(
        fx.account,
        "NotRecoveryAddress",
      );
      await fx.account.connect(fx.recovery).initiateRecovery(fx.bob.address);
      await expect(fx.account.completeRecovery()).to.be.revertedWithCustomError(fx.account, "RecoveryNotReady");

      await time.increase(3 * DAY);
      await fx.account.completeRecovery();
      expect(await fx.account.owner()).to.equal(fx.bob.address);
      expect(await fx.account.isLocked()).to.equal(true);
      await expect(fx.account.connect(fx.bob).execute(fx.bob.address, 1, "0x")).to.be.revertedWithCustomError(
        fx.account,
        "WalletIsLocked",
      );
    });

    it("can be cancelled by the owner", async () => {
      const fx = await loadFixture(accountFixture);
      await fx.account.connect(fx.alice).setRecovery(fx.recovery.address, DAYS(3));
      await fx.account.connect(fx.recovery).initiateRecovery(fx.bob.address);
      await expect(fx.account.connect(fx.alice).cancelRecovery()).to.emit(fx.account, "RecoveryCancelled");
      await time.increase(4 * DAY);
      await expect(fx.account.completeRecovery()).to.be.revertedWithCustomError(fx.account, "NoPendingRecovery");
      expect(await fx.account.owner()).to.equal(fx.alice.address);
    });
  });
});
