import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { DAY, deployProtocol, eth } from "./helpers";

const DAYS = (n: number) => BigInt(n * DAY);
const Standard = { ERC721: 0, ERC1155: 1 };
const Status = { None: 0n, Active: 1n, Withdrawn: 2n, EarlyUnlocked: 3n };
const MIN_FEE = eth("0.001");
const MAX_FEE = eth("0.01");

async function nftFixture() {
  const fx = await deployProtocol();
  const nftVault = await ethers.deployContract("NftLockVault", [await fx.config.getAddress(), MIN_FEE, MAX_FEE]);
  const collectibles = await ethers.deployContract("MockCollectibles");
  const editions = await ethers.deployContract("MockEditions");
  await Promise.all([nftVault, collectibles, editions].map((c) => c.waitForDeployment()));
  await collectibles.mint(fx.alice.address, 1);
  await collectibles.mint(fx.alice.address, 2);
  await collectibles.mint(fx.bob.address, 3);
  await editions.mint(fx.alice.address, 7, 10);
  await editions.mint(fx.bob.address, 7, 5);
  return { ...fx, nftVault, collectibles, editions };
}

type Fx = Awaited<ReturnType<typeof nftFixture>>;

async function lock721At(fx: Fx, tokenId: number, days: number) {
  await fx.collectibles.connect(fx.alice).approve(fx.nftVault, tokenId);
  const start = BigInt(await time.latest()) + 10n;
  const end = start + DAYS(days);
  await time.setNextBlockTimestamp(start);
  await fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, tokenId, 1, end, MIN_FEE, MAX_FEE);
  return { id: await fx.nftVault.lockCount(), start, end };
}

describe("NftLockVault (NFT Lock)", () => {
  describe("locking", () => {
    it("locks an ERC-721 with a single-token approval", async () => {
      const fx = await loadFixture(nftFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.collectibles.connect(fx.alice).approve(fx.nftVault, 1);
      await expect(fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 1, 1, end, MIN_FEE, MAX_FEE))
        .to.emit(fx.nftVault, "NftLocked")
        .withArgs(1n, fx.alice.address, await fx.collectibles.getAddress(), Standard.ERC721, 1n, 1n, anyValue, end, MIN_FEE, MAX_FEE);

      expect(await fx.collectibles.ownerOf(1)).to.equal(await fx.nftVault.getAddress());
      const l = await fx.nftVault.getLock(1);
      expect(l.owner).to.equal(fx.alice.address);
      expect(l.status).to.equal(Status.Active);
      expect(l.minFee).to.equal(MIN_FEE);
      expect(l.maxFee).to.equal(MAX_FEE);
      expect(await fx.nftVault.lockIdsOf(fx.alice.address)).to.deep.equal([1n]);
    });

    it("only locks NFTs owned by the caller, with valid amounts and durations", async () => {
      const fx = await loadFixture(nftFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.collectibles.connect(fx.bob).approve(fx.nftVault, 3);
      await expect(fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 3, 1, end, MIN_FEE, MAX_FEE)).to.be.reverted;
      await expect(fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 1, 1, end, MIN_FEE, MAX_FEE)).to.be.reverted;
      await fx.collectibles.connect(fx.alice).approve(fx.nftVault, 1);
      await expect(
        fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 1, 2, end, MIN_FEE, MAX_FEE),
      ).to.be.revertedWithCustomError(fx.nftVault, "InvalidAmount");
      await expect(
        fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 1, 1, BigInt(await time.latest()), MIN_FEE, MAX_FEE),
      ).to.be.revertedWithCustomError(fx.config, "LockDurationOutOfRange");
    });

    it("locks ERC-1155 amounts, each lock independent", async () => {
      const fx = await loadFixture(nftFixture);
      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.editions.connect(fx.alice).setApprovalForAll(fx.nftVault, true);
      await fx.editions.connect(fx.bob).setApprovalForAll(fx.nftVault, true);
      await fx.nftVault.connect(fx.alice).lock(fx.editions, Standard.ERC1155, 7, 4, end, MIN_FEE, MAX_FEE);
      await fx.nftVault.connect(fx.bob).lock(fx.editions, Standard.ERC1155, 7, 5, end, MIN_FEE, MAX_FEE);
      expect(await fx.editions.balanceOf(fx.nftVault, 7)).to.equal(9n);
      expect(await fx.editions.balanceOf(fx.alice.address, 7)).to.equal(6n);
      await expect(
        fx.nftVault.connect(fx.alice).lock(fx.editions, Standard.ERC1155, 7, 0, end, MIN_FEE, MAX_FEE),
      ).to.be.revertedWithCustomError(fx.nftVault, "InvalidAmount");

      await time.increaseTo(end);
      await fx.nftVault.connect(fx.alice).withdraw(1);
      expect(await fx.editions.balanceOf(fx.alice.address, 7)).to.equal(10n);
      expect(await fx.editions.balanceOf(fx.nftVault, 7)).to.equal(5n);
    });

    it("refuses NFTs sent directly, so nothing can get stuck", async () => {
      const fx = await loadFixture(nftFixture);
      const vault = await fx.nftVault.getAddress();
      await expect(
        fx.collectibles.connect(fx.alice)["safeTransferFrom(address,address,uint256)"](fx.alice.address, vault, 1),
      ).to.be.reverted;
      await expect(fx.editions.connect(fx.alice).safeTransferFrom(fx.alice.address, vault, 7, 1, "0x")).to.be.reverted;
    });
  });

  describe("closing", () => {
    it("returns the NFT at maturity, once, to the owner only", async () => {
      const fx = await loadFixture(nftFixture);
      const { id, end } = await lock721At(fx, 1, 30);
      await expect(fx.nftVault.connect(fx.alice).withdraw(id))
        .to.be.revertedWithCustomError(fx.nftVault, "LockNotMatured")
        .withArgs(end);
      await time.increaseTo(end);
      await expect(fx.nftVault.connect(fx.bob).withdraw(id)).to.be.revertedWithCustomError(fx.nftVault, "NotLockOwner");
      await expect(fx.nftVault.connect(fx.alice).withdraw(id)).to.emit(fx.nftVault, "NftWithdrawn");
      expect(await fx.collectibles.ownerOf(1)).to.equal(fx.alice.address);
      await expect(fx.nftVault.connect(fx.alice).withdraw(id)).to.be.revertedWithCustomError(fx.nftVault, "LockNotActive");
      expect((await fx.nftVault.getLock(id)).status).to.equal(Status.Withdrawn);
    });

    it("unlocks early for the exact native-coin fee and refunds any excess", async () => {
      const fx = await loadFixture(nftFixture);
      const { id, start } = await lock721At(fx, 1, 90);
      const fee = eth("0.0055");
      await expect(fx.nftVault.connect(fx.alice).unlockEarly(id, { value: 1n })).to.be.revertedWithCustomError(
        fx.nftVault,
        "InsufficientFee",
      );

      await time.setNextBlockTimestamp(start + DAYS(45));
      const tx = fx.nftVault.connect(fx.alice).unlockEarly(id, { value: eth("1") });
      await expect(tx)
        .to.emit(fx.nftVault, "NftUnlockedEarly")
        .withArgs(id, fx.alice.address, await fx.collectibles.getAddress(), 1n, 1n, fee);
      await expect(tx).to.changeEtherBalances([fx.alice, fx.nftVault], [-fee, fee]);
      expect(await fx.collectibles.ownerOf(1)).to.equal(fx.alice.address);
      const l = await fx.nftVault.getLock(id);
      expect(l.status).to.equal(Status.EarlyUnlocked);
      expect(l.feePaid).to.equal(fee);

      await expect(fx.nftVault.claimFees()).to.changeEtherBalance(fx.treasury, fee);
      await expect(fx.nftVault.claimFees()).to.be.revertedWithCustomError(fx.nftVault, "NothingToClaim");
    });

    it("previews the fee and refuses an early unlock after maturity", async () => {
      const fx = await loadFixture(nftFixture);
      const { id, start, end } = await lock721At(fx, 2, 100);
      expect(await fx.nftVault.earlyUnlockFeeAt(id, start + DAYS(75))).to.equal(MIN_FEE + ((MAX_FEE - MIN_FEE) * 25n) / 100n);
      await time.increaseTo(end);
      expect(await fx.nftVault.previewEarlyUnlock(id)).to.equal(0n);
      await expect(fx.nftVault.connect(fx.alice).unlockEarly(id, { value: MAX_FEE })).to.be.revertedWithCustomError(
        fx.nftVault,
        "LockMatured",
      );
    });
  });

  describe("terms and administration", () => {
    it("protects users against a fee change between preview and transaction", async () => {
      const fx = await loadFixture(nftFixture);
      const { id, start } = await lock721At(fx, 1, 90);
      await fx.nftVault.connect(fx.admin).setEarlyUnlockFee(eth("0.1"), eth("1"));

      const end = BigInt(await time.latest()) + DAYS(30);
      await fx.collectibles.connect(fx.alice).approve(fx.nftVault, 2);
      await expect(fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 2, 1, end, MIN_FEE, MAX_FEE))
        .to.be.revertedWithCustomError(fx.nftVault, "FeeTermsChanged")
        .withArgs(eth("0.1"), eth("1"));
      await fx.nftVault.connect(fx.admin).setEarlyUnlockFee(MAX_FEE, MAX_FEE);
      await expect(fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 2, 1, end, MIN_FEE, MAX_FEE))
        .to.be.revertedWithCustomError(fx.nftVault, "FeeTermsChanged")
        .withArgs(MAX_FEE, MAX_FEE);
      await fx.nftVault.connect(fx.admin).setEarlyUnlockFee(0, MIN_FEE);
      await fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 2, 1, end, MIN_FEE, MAX_FEE);
      const created = await fx.nftVault.getLock(await fx.nftVault.lockCount());
      expect(created.minFee).to.equal(0n);
      expect(created.maxFee).to.equal(MIN_FEE);
      expect(await fx.nftVault.PROTOCOL_VERSION()).to.equal(3n);

      await time.setNextBlockTimestamp(start + DAYS(45));
      await expect(fx.nftVault.connect(fx.alice).unlockEarly(id, { value: eth("0.0055") })).to.emit(
        fx.nftVault,
        "NftUnlockedEarly",
      );
    });

    it("restricts administration to the protocol owner; pausing never traps NFTs", async () => {
      const fx = await loadFixture(nftFixture);
      const { id, end } = await lock721At(fx, 1, 30);
      await expect(fx.nftVault.connect(fx.alice).setEarlyUnlockFee(0, 0)).to.be.revertedWithCustomError(
        fx.nftVault,
        "NotAdmin",
      );
      await expect(fx.nftVault.connect(fx.admin).setEarlyUnlockFee(2, 1)).to.be.revertedWithCustomError(
        fx.nftVault,
        "InvalidFeeRange",
      );
      await expect(fx.nftVault.connect(fx.alice).pause()).to.be.revertedWithCustomError(fx.nftVault, "NotAdmin");
      await fx.nftVault.connect(fx.admin).pause();

      await fx.collectibles.connect(fx.alice).approve(fx.nftVault, 2);
      await expect(
        fx.nftVault.connect(fx.alice).lock(fx.collectibles, Standard.ERC721, 2, 1, end + DAYS(1), MIN_FEE, MAX_FEE),
      ).to.be.revertedWithCustomError(fx.nftVault, "EnforcedPause");

      await time.increaseTo(end);
      await fx.nftVault.connect(fx.alice).withdraw(id);
      expect(await fx.collectibles.ownerOf(1)).to.equal(fx.alice.address);
    });
  });
});
