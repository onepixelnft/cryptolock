import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { DAY, MAX_FEE_BPS, MIN_FEE_BPS, deployProtocol, eth, expectedFeeBps, usdc } from "./helpers";

const NATIVE = ethers.ZeroAddress;
const NO_VAULT = ethers.ZeroAddress;
const DAYS = (n: number) => BigInt(n * DAY);
const Status = { None: 0n, Active: 1n, Withdrawn: 2n, EarlyUnlocked: 3n, WithdrawnAsShares: 4n };
const POOL_SHARES_PER_UNIT = 1_000_000n;

type Fixture = Awaited<ReturnType<typeof deployProtocol>>;

const reviewed = (vault: string = NO_VAULT) => [vault, MIN_FEE_BPS, MAX_FEE_BPS] as const;

async function lockUsdcAt(fx: Fixture, amount: bigint, days: number, stake = false) {
  await fx.usdc.connect(fx.alice).approve(fx.vault, amount);
  const start = BigInt(await time.latest()) + 10n;
  const end = start + DAYS(days);
  await time.setNextBlockTimestamp(start);
  const vault = stake ? await fx.usdcVault.getAddress() : NO_VAULT;
  await fx.vault.connect(fx.alice).lock(fx.usdc, amount, end, ...reviewed(vault));
  return { id: await fx.vault.lockCount(), start, end };
}

describe("LockVault (Crypto Lock)", () => {
  describe("locking", () => {
    it("locks an ERC-20 and records an independent lock", async () => {
      const fx = await loadFixture(deployProtocol);
      const amount = usdc(5_000);
      const end = BigInt(await time.latest()) + DAYS(90);
      await fx.usdc.connect(fx.alice).approve(fx.vault, amount);

      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, amount, end, ...reviewed()))
        .to.emit(fx.vault, "Locked")
        .withArgs(1n, fx.alice.address, await fx.usdc.getAddress(), amount, anyValue, end, NATIVE, amount * POOL_SHARES_PER_UNIT, MIN_FEE_BPS, MAX_FEE_BPS);

      const l = await fx.vault.getLock(1);
      expect(l.owner).to.equal(fx.alice.address);
      expect(l.status).to.equal(Status.Active);
      expect(l.amount).to.equal(amount);
      expect(l.shares).to.equal(amount * POOL_SHARES_PER_UNIT);
      expect(await fx.vault.currentValue(1)).to.equal(amount);
      expect(await fx.vault.poolBalance(fx.usdc)).to.equal(amount);
      expect(l.end).to.equal(end);
      expect(l.minFeeBps).to.equal(MIN_FEE_BPS);
      expect(l.maxFeeBps).to.equal(MAX_FEE_BPS);
      expect(await fx.usdc.balanceOf(fx.vault)).to.equal(amount);
      expect(await fx.vault.totalPrincipalLocked(fx.usdc)).to.equal(amount);
      expect(await fx.vault.lockIdsOf(fx.alice.address)).to.deep.equal([1n]);
      expect(await fx.vault.PROTOCOL_VERSION()).to.equal(3n);
    });

    it("locks the native coin", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(7);
      await expect(
        fx.vault.connect(fx.alice).lock(NATIVE, eth("2"), end, ...reviewed(), { value: eth("2") }),
      ).to.changeEtherBalances([fx.alice, fx.vault], [-eth("2"), eth("2")]);
      expect((await fx.vault.getLock(1)).token).to.equal(NATIVE);
      expect(await fx.vault.totalPrincipalLocked(NATIVE)).to.equal(eth("2"));
    });

    it("rejects zero amounts, mismatched coin values and out-of-range durations", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(7);
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(10));

      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, 0, end, ...reviewed())).to.be.revertedWithCustomError(
        fx.vault,
        "ZeroAmount",
      );
      await expect(
        fx.vault.connect(fx.alice).lock(NATIVE, eth("1"), end, ...reviewed(), { value: eth("0.5") }),
      ).to.be.revertedWithCustomError(fx.vault, "InvalidNativeValue");
      await expect(
        fx.vault.connect(fx.alice).lock(fx.usdc, usdc(10), end, ...reviewed(), { value: 1 }),
      ).to.be.revertedWithCustomError(fx.vault, "InvalidNativeValue");

      const now = BigInt(await time.latest());
      await expect(
        fx.vault.connect(fx.alice).lock(fx.usdc, usdc(10), now, ...reviewed()),
      ).to.be.revertedWithCustomError(fx.config, "LockDurationOutOfRange");
      await expect(
        fx.vault.connect(fx.alice).lock(fx.usdc, usdc(10), now + DAYS(3651), ...reviewed()),
      ).to.be.revertedWithCustomError(fx.config, "LockDurationOutOfRange");
    });

    it("keeps several simultaneous locks independent", async () => {
      const fx = await loadFixture(deployProtocol);
      const now = BigInt(await time.latest());
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(600));
      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), now + DAYS(7), ...reviewed());
      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(200), now + DAYS(30), ...reviewed());
      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(300), now + DAYS(90), ...reviewed());
      expect(await fx.vault.lockIdsOf(fx.alice.address)).to.deep.equal([1n, 2n, 3n]);

      await time.increaseTo(now + DAYS(7));
      await fx.vault.connect(fx.alice).withdraw(1);
      await expect(fx.vault.connect(fx.alice).withdraw(2)).to.be.revertedWithCustomError(fx.vault, "LockNotMatured");

      const locks = await fx.vault.getLocks([1, 2, 3]);
      expect(locks.map((l) => l.status)).to.deep.equal([Status.Withdrawn, Status.Active, Status.Active]);
      expect(await fx.vault.totalPrincipalLocked(fx.usdc)).to.equal(usdc(500));
    });

    it("records the amount actually received for fee-on-transfer tokens", async () => {
      const fx = await loadFixture(deployProtocol);
      const fot = await ethers.deployContract("MockFeeOnTransferERC20");
      await fot.mint(fx.alice.address, eth("1000"));
      await fot.connect(fx.alice).approve(fx.vault, eth("100"));
      const end = BigInt(await time.latest()) + DAYS(7);
      await fx.vault.connect(fx.alice).lock(fot, eth("100"), end, ...reviewed());
      expect((await fx.vault.getLock(1)).amount).to.equal(eth("99"));

      await time.increaseTo(end);
      await fx.vault.connect(fx.alice).withdraw(1);
      expect(await fot.balanceOf(fx.vault)).to.equal(0n);
    });

    it("refuses direct coin transfers", async () => {
      const fx = await loadFixture(deployProtocol);
      await expect(fx.alice.sendTransaction({ to: fx.vault, value: 1 })).to.be.revertedWithCustomError(
        fx.vault,
        "UnexpectedNativeTransfer",
      );
    });
  });

  describe("terms reviewed by the owner", () => {
    it("reverts if the fee terms rose after the review, in either bound", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(300));

      await fx.config.setEarlyUnlockFee(MIN_FEE_BPS, MAX_FEE_BPS + 1n);
      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed()))
        .to.be.revertedWithCustomError(fx.vault, "FeeTermsChanged")
        .withArgs(MIN_FEE_BPS, MAX_FEE_BPS + 1n);

      await fx.config.setEarlyUnlockFee(MAX_FEE_BPS, MAX_FEE_BPS);
      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed()))
        .to.be.revertedWithCustomError(fx.vault, "FeeTermsChanged")
        .withArgs(MAX_FEE_BPS, MAX_FEE_BPS);
    });

    it("accepts lower terms than reviewed and records the terms actually applied", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(100));
      await fx.config.setEarlyUnlockFee(50, 200);

      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed());
      const l = await fx.vault.getLock(1);
      expect(l.minFeeBps).to.equal(50n);
      expect(l.maxFeeBps).to.equal(200n);
    });

    it("only stakes in the vault the owner reviewed", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(100));
      const reviewedVault = await fx.usdcVault.getAddress();

      const other = await ethers.deployContract("MockYieldVault", [await fx.usdc.getAddress(), "Other", "oUSDC"]);
      await fx.config.setStakingVault(fx.usdc, other);
      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed(reviewedVault)))
        .to.be.revertedWithCustomError(fx.vault, "StakingVaultChanged")
        .withArgs(reviewedVault, await other.getAddress());

      await fx.config.setStakingVault(fx.usdc, ethers.ZeroAddress);
      await expect(fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed(reviewedVault)))
        .to.be.revertedWithCustomError(fx.vault, "StakingUnavailable")
        .withArgs(await fx.usdc.getAddress());

      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), end, ...reviewed());
      expect((await fx.vault.getLock(1)).vault).to.equal(NO_VAULT);
    });
  });

  describe("withdrawal at maturity", () => {
    it("is only possible at maturity, once, and by the owner", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, end } = await lockUsdcAt(fx, usdc(1_000), 30);

      await expect(fx.vault.connect(fx.alice).withdraw(id))
        .to.be.revertedWithCustomError(fx.vault, "LockNotMatured")
        .withArgs(end);

      await time.increaseTo(end);
      await expect(fx.vault.connect(fx.bob).withdraw(id)).to.be.revertedWithCustomError(fx.vault, "NotLockOwner");
      await expect(fx.vault.connect(fx.alice).withdraw(id)).to.changeTokenBalances(
        fx.usdc,
        [fx.alice, fx.vault],
        [usdc(1_000), -usdc(1_000)],
      );
      await expect(fx.vault.connect(fx.alice).withdraw(id)).to.be.revertedWithCustomError(fx.vault, "LockNotActive");
      await expect(fx.vault.connect(fx.alice).withdraw(99)).to.be.revertedWithCustomError(fx.vault, "UnknownLock");

      const l = await fx.vault.getLock(id);
      expect(l.status).to.equal(Status.Withdrawn);
      expect(l.amountOut).to.equal(usdc(1_000));
      expect(l.fee).to.equal(0n);
    });
  });

  describe("early unlock", () => {
    it("charges the snapshotted fee: 5,000 USDC, 45 of 90 days left → 3% fee", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, start, end } = await lockUsdcAt(fx, usdc(5_000), 90);

      await time.increaseTo(start + DAYS(45) - 10n);
      const [gross, previewBps, previewFee, previewOut] = await fx.vault.previewEarlyUnlock(id);
      expect(gross).to.equal(usdc(5_000));
      expect(previewBps).to.be.closeTo(300n, 1n);
      expect(previewFee + previewOut).to.equal(gross);

      const at = start + DAYS(45);
      expect(expectedFeeBps(MIN_FEE_BPS, MAX_FEE_BPS, start, end, at)).to.equal(300n);
      expect(await fx.vault.earlyUnlockFeeBpsAt(id, at)).to.equal(300n);

      await time.setNextBlockTimestamp(at);
      const tx = fx.vault.connect(fx.alice).unlockEarly(id, usdc(4_850));
      await expect(tx)
        .to.emit(fx.vault, "UnlockedEarly")
        .withArgs(id, fx.alice.address, await fx.usdc.getAddress(), usdc(5_000), 300n, usdc(150), usdc(4_850));
      await expect(tx).to.changeTokenBalances(fx.usdc, [fx.alice, fx.vault], [usdc(4_850), -usdc(4_850)]);

      const l = await fx.vault.getLock(id);
      expect(l.status).to.equal(Status.EarlyUnlocked);
      expect(l.fee).to.equal(usdc(150));
      expect(l.amountOut).to.equal(usdc(4_850));
      expect(await fx.vault.accruedFees(fx.usdc)).to.equal(usdc(150));

      await expect(fx.vault.claimFees(fx.usdc)).to.changeTokenBalance(fx.usdc, fx.treasury, usdc(150));
      await expect(fx.vault.claimFees(fx.usdc)).to.be.revertedWithCustomError(fx.vault, "NothingToClaim");
    });

    it("keeps the fee terms of the lock even if the protocol changes them", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, start, end } = await lockUsdcAt(fx, usdc(1_000), 100);
      await fx.config.setEarlyUnlockFee(1_000, 2_000);

      const at = start + DAYS(25);
      await time.setNextBlockTimestamp(at);
      const bps = expectedFeeBps(MIN_FEE_BPS, MAX_FEE_BPS, start, end, at);
      expect(bps).to.equal(400n);
      await expect(fx.vault.connect(fx.alice).unlockEarly(id, 0))
        .to.emit(fx.vault, "UnlockedEarly")
        .withArgs(id, fx.alice.address, await fx.usdc.getAddress(), usdc(1_000), bps, usdc(40), usdc(960));
    });

    it("respects minAmountOut, the owner and maturity", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, start, end } = await lockUsdcAt(fx, usdc(5_000), 90);
      await time.setNextBlockTimestamp(start + DAYS(45));
      await expect(fx.vault.connect(fx.alice).unlockEarly(id, usdc(4_851)))
        .to.be.revertedWithCustomError(fx.vault, "SlippageExceeded")
        .withArgs(usdc(4_850), usdc(4_851));
      await expect(fx.vault.connect(fx.bob).unlockEarly(id, 0)).to.be.revertedWithCustomError(
        fx.vault,
        "NotLockOwner",
      );

      await time.increaseTo(end);
      await expect(fx.vault.connect(fx.alice).unlockEarly(id, 0)).to.be.revertedWithCustomError(
        fx.vault,
        "LockMatured",
      );
      const [, bps, fee] = await fx.vault.previewEarlyUnlock(id);
      expect(bps).to.equal(0n);
      expect(fee).to.equal(0n);
    });
  });

  describe("staking", () => {
    it("deposits into the whitelisted vault and returns principal plus yield", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, end } = await lockUsdcAt(fx, usdc(1_000), 30, true);

      const l = await fx.vault.getLock(id);
      expect(l.vault).to.equal(await fx.usdcVault.getAddress());
      expect(l.shares).to.be.gt(0n);
      expect(await fx.usdcVault.balanceOf(fx.vault)).to.equal(l.shares);
      expect(await fx.usdc.balanceOf(fx.vault)).to.equal(0n);
      expect(await fx.usdc.allowance(fx.vault, fx.usdcVault)).to.equal(0n);
      expect(await fx.vault.totalSharesLocked(fx.usdcVault)).to.equal(l.shares);

      await fx.usdc.mint(await fx.usdcVault.getAddress(), usdc(100));
      const value = await fx.vault.currentValue(id);
      expect(value).to.be.closeTo(usdc(1_100), 1n);

      await time.increaseTo(end);
      await expect(fx.vault.connect(fx.alice).withdraw(id)).to.changeTokenBalance(fx.usdc, fx.alice, value);
      expect((await fx.vault.getLock(id)).amountOut).to.equal(value);
      expect(await fx.vault.totalSharesLocked(fx.usdcVault)).to.equal(0n);
    });

    it("charges the early-unlock fee on the redeemed value", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, start } = await lockUsdcAt(fx, usdc(1_000), 90, true);
      await fx.usdc.mint(await fx.usdcVault.getAddress(), usdc(100));
      const gross = await fx.vault.currentValue(id);

      await time.setNextBlockTimestamp(start + DAYS(45));
      const fee = (gross * 300n) / 10_000n;
      await expect(fx.vault.connect(fx.alice).unlockEarly(id, 0))
        .to.emit(fx.vault, "UnlockedEarly")
        .withArgs(id, fx.alice.address, await fx.usdc.getAddress(), gross, 300n, fee, gross - fee);
      expect(await fx.vault.accruedFees(fx.usdc)).to.equal(fee);
    });

    it("wraps the native coin to stake it and unwraps it on withdrawal", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(30);
      const wethVault = await fx.wethVault.getAddress();
      await fx.vault.connect(fx.alice).lock(NATIVE, eth("1"), end, ...reviewed(wethVault), { value: eth("1") });

      const l = await fx.vault.getLock(1);
      expect(l.vault).to.equal(wethVault);
      expect(await fx.wethVault.balanceOf(fx.vault)).to.equal(l.shares);
      expect(await ethers.provider.getBalance(fx.vault)).to.equal(0n);

      await fx.weth.connect(fx.bob).deposit({ value: eth("0.1") });
      await fx.weth.connect(fx.bob).transfer(fx.wethVault, eth("0.1"));

      await time.increaseTo(end);
      const value = await fx.vault.currentValue(1);
      expect(value).to.be.closeTo(eth("1.1"), 1n);
      await expect(fx.vault.connect(fx.alice).withdraw(1)).to.changeEtherBalance(fx.alice, value);
    });

    it("is refused for tokens without a whitelisted vault", async () => {
      const fx = await loadFixture(deployProtocol);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.dai.connect(fx.alice).approve(fx.vault, eth("10"));
      await expect(fx.vault.connect(fx.alice).lock(fx.dai, eth("10"), end, ...reviewed(await fx.usdcVault.getAddress())))
        .to.be.revertedWithCustomError(fx.vault, "StakingUnavailable")
        .withArgs(await fx.dai.getAddress());
    });

    it("keeps the vault of existing locks when the protocol changes it", async () => {
      const fx = await loadFixture(deployProtocol);
      const { id, end } = await lockUsdcAt(fx, usdc(500), 30, true);
      await fx.config.setStakingVault(fx.usdc, ethers.ZeroAddress);
      await time.increaseTo(end);
      await expect(fx.vault.connect(fx.alice).withdraw(id)).to.changeTokenBalance(fx.usdc, fx.alice, usdc(500));
    });

    it("hands the vault shares to the owner when the vault cannot redeem at maturity", async () => {
      const fx = await loadFixture(deployProtocol);
      const staked = await lockUsdcAt(fx, usdc(800), 30, true);
      const idle = await lockUsdcAt(fx, usdc(100), 30);
      const { shares } = await fx.vault.getLock(staked.id);
      await fx.usdcVault.setRedemptionsPaused(true);

      await expect(fx.vault.connect(fx.alice).withdrawShares(staked.id))
        .to.be.revertedWithCustomError(fx.vault, "LockNotMatured")
        .withArgs(staked.end);
      await time.increaseTo(idle.end);
      await expect(fx.vault.connect(fx.alice).withdraw(staked.id)).to.be.revertedWithCustomError(
        fx.usdcVault,
        "ERC4626ExceededMaxRedeem",
      );
      await expect(fx.vault.connect(fx.alice).withdrawShares(idle.id)).to.be.revertedWithCustomError(
        fx.vault,
        "NotStaked",
      );
      await expect(fx.vault.connect(fx.bob).withdrawShares(staked.id)).to.be.revertedWithCustomError(
        fx.vault,
        "NotLockOwner",
      );

      await expect(fx.vault.connect(fx.alice).withdrawShares(staked.id))
        .to.emit(fx.vault, "SharesWithdrawn")
        .withArgs(staked.id, fx.alice.address, await fx.usdcVault.getAddress(), shares);
      expect(await fx.usdcVault.balanceOf(fx.alice.address)).to.equal(shares);
      expect(await fx.vault.totalSharesLocked(fx.usdcVault)).to.equal(0n);
      const l = await fx.vault.getLock(staked.id);
      expect(l.status).to.equal(Status.WithdrawnAsShares);
      expect(l.amountOut).to.equal(0n);
      await expect(fx.vault.connect(fx.alice).withdrawShares(staked.id)).to.be.revertedWithCustomError(
        fx.vault,
        "LockNotActive",
      );

      await fx.usdcVault.setRedemptionsPaused(false);
      await expect(
        fx.usdcVault.connect(fx.alice).redeem(shares, fx.alice.address, fx.alice.address),
      ).to.changeTokenBalance(fx.usdc, fx.alice, usdc(800));
    });
  });

  describe("any ERC-20 token: pooled accounting", () => {
    async function rebasingFixture() {
      const fx = await deployProtocol();
      const reb = await ethers.deployContract("MockRebasingERC20");
      for (const user of [fx.alice, fx.bob]) {
        await reb.mint(user.address, eth("1000"));
        await reb.connect(user).approve(fx.vault, ethers.MaxUint256);
      }
      return { ...fx, reb };
    }

    it("returns exact amounts for ordinary tokens, whatever the order of exits", async () => {
      const fx = await loadFixture(deployProtocol);
      const now = BigInt(await time.latest());
      await fx.dai.connect(fx.alice).approve(fx.vault, ethers.MaxUint256);
      await fx.dai.connect(fx.bob).approve(fx.vault, ethers.MaxUint256);
      await fx.vault.connect(fx.alice).lock(fx.dai, eth("123.456789"), now + DAYS(10), ...reviewed());
      await fx.vault.connect(fx.bob).lock(fx.dai, 7n, now + DAYS(20), ...reviewed());
      await fx.vault.connect(fx.alice).lock(fx.dai, eth("500"), now + DAYS(30), ...reviewed());
      expect(await fx.vault.currentValue(1)).to.equal(eth("123.456789"));
      expect(await fx.vault.currentValue(2)).to.equal(7n);

      await fx.vault.connect(fx.alice).unlockEarly(3, 0);
      expect(await fx.vault.accruedFees(fx.dai)).to.be.gt(0n);
      expect(await fx.vault.currentValue(1)).to.equal(eth("123.456789"));
      expect(await fx.vault.currentValue(2)).to.equal(7n);
      await fx.vault.claimFees(fx.dai);
      expect(await fx.vault.currentValue(2)).to.equal(7n);

      await time.increaseTo(now + DAYS(20));
      await expect(fx.vault.connect(fx.bob).withdraw(2)).to.changeTokenBalance(fx.dai, fx.bob, 7n);
      await expect(fx.vault.connect(fx.alice).withdraw(1)).to.changeTokenBalance(fx.dai, fx.alice, eth("123.456789"));
      expect(await fx.dai.balanceOf(fx.vault)).to.equal(0n);
      expect(await fx.vault.totalPoolShares(fx.dai)).to.equal(0n);
    });

    it("shares the rebases of a rebasing token between its locks, up and down", async () => {
      const fx = await loadFixture(rebasingFixture);
      const now = BigInt(await time.latest());
      await fx.vault.connect(fx.alice).lock(fx.reb, eth("100"), now + DAYS(10), ...reviewed());
      await fx.vault.connect(fx.bob).lock(fx.reb, eth("300"), now + DAYS(10), ...reviewed());
      expect(await fx.vault.currentValue(1)).to.be.closeTo(eth("100"), 2n);
      expect(await fx.vault.currentValue(2)).to.be.closeTo(eth("300"), 2n);

      await fx.reb.rebase(110, 100);
      expect(await fx.vault.currentValue(1)).to.be.closeTo(eth("110"), 3n);
      expect(await fx.vault.currentValue(2)).to.be.closeTo(eth("330"), 3n);
      const [gross] = await fx.vault.previewEarlyUnlock(1);
      expect(gross).to.equal(await fx.vault.currentValue(1));

      await fx.reb.rebase(50, 110);
      expect(await fx.vault.currentValue(1)).to.be.closeTo(eth("50"), 3n);
      expect(await fx.vault.currentValue(2)).to.be.closeTo(eth("150"), 3n);

      await time.increaseTo(now + DAYS(10));
      const before = await fx.reb.balanceOf(fx.alice.address);
      await fx.vault.connect(fx.alice).withdraw(1);
      expect((await fx.reb.balanceOf(fx.alice.address)) - before).to.be.closeTo(eth("50"), 4n);
      await fx.vault.connect(fx.bob).withdraw(2);
      expect((await fx.vault.getLock(2)).amountOut).to.be.closeTo(eth("150"), 4n);
      expect(await fx.reb.balanceOf(fx.vault)).to.be.lt(10n);
    });

    it("makes a donation attack on a new pool cost its author far more than the victim loses", async () => {
      const fx = await loadFixture(deployProtocol);
      const [attacker, victim] = [fx.bob, fx.alice];
      const end = BigInt(await time.latest()) + DAYS(10);
      await fx.dai.connect(attacker).approve(fx.vault, ethers.MaxUint256);
      await fx.dai.connect(victim).approve(fx.vault, ethers.MaxUint256);
      const initial = await fx.dai.balanceOf(attacker.address);

      await fx.vault.connect(attacker).lock(fx.dai, 1n, end, ...reviewed());
      await fx.dai.connect(attacker).transfer(fx.vault, eth("100000"));
      await fx.vault.connect(victim).lock(fx.dai, eth("1000"), end, ...reviewed());
      expect(await fx.vault.currentValue(2)).to.be.gte(eth("999.9"));

      await time.increaseTo(end);
      await fx.vault.connect(attacker).withdraw(1);
      expect(await fx.dai.balanceOf(attacker.address)).to.be.lt(initial - eth("40000"));
      await expect(fx.vault.connect(victim).withdraw(2)).to.changeTokenBalance(fx.dai, victim, await fx.vault.currentValue(2));
    });

    it("keeps the pool apart from uncollected fees and from the vault shares of staked locks", async () => {
      const fx = await loadFixture(deployProtocol);
      const now = BigInt(await time.latest());
      const usdcVault = await fx.usdcVault.getAddress();
      await fx.usdc.connect(fx.alice).approve(fx.usdcVault, usdc(1_000));
      await fx.usdcVault.connect(fx.alice).deposit(usdc(1_000), fx.alice.address);
      const aliceShares = await fx.usdcVault.balanceOf(fx.alice.address);
      await fx.usdc.connect(fx.bob).approve(fx.vault, usdc(500));
      await fx.vault.connect(fx.bob).lock(fx.usdc, usdc(500), now + DAYS(30), ...reviewed(usdcVault));
      await fx.usdcVault.connect(fx.alice).approve(fx.vault, aliceShares);
      await fx.vault.connect(fx.alice).lock(usdcVault, aliceShares, now + DAYS(30), ...reviewed());
      expect(await fx.vault.poolBalance(usdcVault)).to.equal(aliceShares);
      expect(await fx.vault.currentValue(2)).to.equal(aliceShares);

      await fx.vault.connect(fx.bob).unlockEarly(1, 0);
      expect(await fx.vault.currentValue(2)).to.equal(aliceShares);
      await time.increaseTo(now + DAYS(30));
      await expect(fx.vault.connect(fx.alice).withdraw(2)).to.changeTokenBalance(fx.usdcVault, fx.alice, aliceShares);
    });

    it("refuses the ERC-20 mirror of the native coin, which is locked as the native coin instead", async () => {
      const fx = await loadFixture(deployProtocol);
      const mirror = await fx.dai.getAddress();
      const vault = await ethers.deployContract("LockVault", [await fx.config.getAddress(), mirror]);
      expect(await vault.nativeTokenAlias()).to.equal(mirror);
      const end = BigInt(await time.latest()) + DAYS(10);
      await fx.dai.connect(fx.alice).approve(vault, eth("1"));
      await expect(vault.connect(fx.alice).lock(mirror, eth("1"), end, ...reviewed())).to.be.revertedWithCustomError(
        vault,
        "NativeTokenAlias",
      );
      await vault.connect(fx.alice).lock(NATIVE, eth("1"), end, ...reviewed(), { value: eth("1") });
      expect(await vault.currentValue(1)).to.equal(eth("1"));
    });
  });

  describe("safety", () => {
    it("pausing blocks new locks but never withdrawals or early unlocks", async () => {
      const fx = await loadFixture(deployProtocol);
      const first = await lockUsdcAt(fx, usdc(100), 30);
      const second = await lockUsdcAt(fx, usdc(100), 30);

      await expect(fx.vault.connect(fx.alice).pause()).to.be.revertedWithCustomError(fx.vault, "NotAdmin");
      await fx.vault.connect(fx.admin).pause();

      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(100));
      await expect(
        fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), second.end + DAYS(1), ...reviewed()),
      ).to.be.revertedWithCustomError(fx.vault, "EnforcedPause");

      await fx.vault.connect(fx.alice).unlockEarly(first.id, 0);
      await time.increaseTo(second.end);
      await fx.vault.connect(fx.alice).withdraw(second.id);

      await fx.vault.connect(fx.admin).unpause();
      await fx.vault.connect(fx.alice).lock(fx.usdc, usdc(100), second.end + DAYS(1), ...reviewed());
    });

    it("is protected against reentrancy", async () => {
      const fx = await loadFixture(deployProtocol);
      const token = await ethers.deployContract("MockReentrantERC20");
      await token.mint(fx.alice.address, eth("100"));
      await token.connect(fx.alice).approve(fx.vault, eth("100"));
      const end = BigInt(await time.latest()) + DAYS(7);
      await fx.vault.connect(fx.alice).lock(token, eth("100"), end, ...reviewed());

      await time.increaseTo(end);
      await token.arm(fx.vault, fx.vault.interface.encodeFunctionData("withdraw", [1n]));
      await expect(fx.vault.connect(fx.alice).withdraw(1)).to.be.revertedWithCustomError(
        fx.vault,
        "ReentrancyGuardReentrantCall",
      );
    });

    it("always holds at least the principal of active locks plus uncollected fees", async () => {
      const fx = await loadFixture(deployProtocol);
      await fx.usdc.connect(fx.bob).approve(fx.vault, usdc(1_000_000));
      await fx.usdc.connect(fx.alice).approve(fx.vault, usdc(1_000_000));
      const now = BigInt(await time.latest());
      const usdcVault = await fx.usdcVault.getAddress();
      const plan: Array<[typeof fx.alice, bigint, number, boolean]> = [
        [fx.alice, usdc(1_234), 10, false],
        [fx.bob, usdc(777), 20, true],
        [fx.alice, usdc(50), 40, false],
        [fx.bob, usdc(9_999), 60, false],
        [fx.alice, usdc(3), 80, true],
      ];
      for (const [who, amount, days, stake] of plan) {
        await fx.vault.connect(who).lock(fx.usdc, amount, now + DAYS(days), ...reviewed(stake ? usdcVault : NO_VAULT));
      }
      await time.increaseTo(now + DAYS(15));
      await fx.vault.connect(fx.alice).withdraw(1);
      await fx.vault.connect(fx.bob).unlockEarly(2, 0);
      await fx.vault.connect(fx.bob).unlockEarly(4, 0);
      await fx.usdc.mint(await fx.usdcVault.getAddress(), usdc(1));

      const balance = await fx.usdc.balanceOf(fx.vault);
      const principal = await fx.vault.totalPrincipalLocked(fx.usdc);
      const fees = await fx.vault.accruedFees(fx.usdc);
      expect(principal).to.equal(usdc(50));
      expect(balance).to.be.gte(principal + fees);
      expect(await fx.usdcVault.balanceOf(fx.vault)).to.equal(await fx.vault.totalSharesLocked(fx.usdcVault));
    });
  });
});
