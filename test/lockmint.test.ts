import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { parseUnits } from "ethers";

describe("pumpBTC Unit Test", function () {
  async function deployContracts() {
    const [owner, admin, user1, user2] = await ethers.getSigners();

    // Deploy LayerZero endpoint mock
    const MockEndpointV2 = await ethers.getContractFactory("MockEndpointV2");
    const mockEndpointV2 = await MockEndpointV2.deploy(10, owner.address);

    // Deploy Mock PumpToken
    const pumpBTC = await ethers.deployContract("MockPumpToken");
    const amount8 = parseUnits("100", 8);
    
    // Deploy PumpTokenOFT
    const PumpTokenOFT = await ethers.getContractFactory("PumpTokenOFT");
    const lzEndpoint = await mockEndpointV2.getAddress();
    const mintAsset = await PumpTokenOFT.deploy(lzEndpoint);

    // Deploy LockMint
    const lockAssetAddress = await pumpBTC.getAddress();
    const mintAssetAddress = await mintAsset.getAddress();

    const LockMint = await ethers.getContractFactory("LockMint");
    const lockMint = await LockMint.deploy(lockAssetAddress, mintAssetAddress);
    const lockMintAddress = await lockMint.getAddress();

    // Set minter and admin
    await pumpBTC.setMinter(owner.address, true);
    await lockMint.setAdmin(owner.address);
    await mintAsset.setMinter(lockMintAddress, true);

    // Distribute tokens, approve for staking
    await pumpBTC.mint(user1.address, amount8);
    await pumpBTC.connect(user1).approve(lockMintAddress, amount8);
    await mintAsset.connect(user1).approve(lockMintAddress, amount8);

    return { pumpBTC, mintAsset, lockMint, owner, admin, user1, user2, lockMintAddress };
  }

  it("should deploy the contract correctly", async function () {
        await loadFixture(deployContracts);
  });

  it("should allow owner to set admin", async function () {
    const { lockMint, owner, admin } = await loadFixture(deployContracts);

    // Set admin to admin.address
    await expect(lockMint.connect(owner).setAdmin(admin.address))
      .to.emit(lockMint, "AdminSet")
      .withArgs(admin.address);

    // Check that admin is set
    expect(await lockMint.admin()).to.equal(admin.address);
  });

  it("should not allow non-owner to set admin", async function () {
    const { lockMint, user1 } = await loadFixture(deployContracts);

    await expect(lockMint.connect(user1).setAdmin(user1.address))
      .to.be.revertedWithCustomError(lockMint, "OwnableUnauthorizedAccount")
      .withArgs(user1.address);
  });

  it("should revert when setting admin to zero address", async function () {
    const { lockMint, owner } = await loadFixture(deployContracts);

    await expect(lockMint.connect(owner).setAdmin(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid admin address"
    );
  });

  it("should allow admin to pause and unpause", async function () {
    const { lockMint, owner, admin } = await loadFixture(deployContracts);

    // Set admin to admin.address
    await lockMint.connect(owner).setAdmin(admin.address);

    // Pause contract
    await lockMint.connect(admin).pause();
    expect(await lockMint.paused()).to.be.true;

    // Unpause contract
    await lockMint.connect(admin).unpause();
    expect(await lockMint.paused()).to.be.false;
  });

  it("should not allow non-admin to pause or unpause", async function () {
    const { lockMint, user1 } = await loadFixture(deployContracts);

    await expect(lockMint.connect(user1).pause()).to.be.revertedWith("Only admin can call this function");
    await expect(lockMint.connect(user1).unpause()).to.be.revertedWith("Only admin can call this function");
  });

  it("should prevent lockMint and burnUnlock when paused", async function () {
    const { lockMint, owner, admin, user1 } = await loadFixture(deployContracts);

    // Set admin and pause contract
    await lockMint.connect(owner).setAdmin(admin.address);
    await lockMint.connect(admin).pause();

    const amount = parseUnits("10", 8);

    // Try to call lockMint and burnUnlock
    await expect(lockMint.connect(user1).lockMint(amount))
      .to.be.revertedWithCustomError(lockMint, "EnforcedPause");
    await expect(lockMint.connect(user1).burnUnlock(amount))
      .to.be.revertedWithCustomError(lockMint, "EnforcedPause");
  });

  it("should lock lockAsset and mint mintAsset", async function () {
    const { lockMint, user1, pumpBTC, mintAsset, lockMintAddress } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);

    // Check initial balances
    const initialLockAssetBalance = await pumpBTC.balanceOf(user1.address);
    const initialMintAssetBalance = await mintAsset.balanceOf(user1.address);

    // Call lockMint
    await expect(lockMint.connect(user1).lockMint(amount))
      .to.emit(lockMint, "Locked")
      .withArgs(user1.address, amount);

    // Check balances after
    expect(await pumpBTC.balanceOf(user1.address)).to.equal(initialLockAssetBalance - amount);
    expect(await mintAsset.balanceOf(user1.address)).to.equal(initialMintAssetBalance + amount);
    expect(await pumpBTC.balanceOf(lockMintAddress)).to.equal(amount);
  });

  it("should revert when amount is zero", async function () {
    const { lockMint, user1 } = await loadFixture(deployContracts);

    await expect(lockMint.connect(user1).lockMint(0)).to.be.revertedWith("LockMint: Amount must be greater than zero");
  });

  it("should revert when user has insufficient lockAsset", async function () {
    const { lockMint, user2, pumpBTC, lockMintAddress } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);
    
    // First approve the spending
    await pumpBTC.connect(user2).approve(lockMintAddress, amount);

    // Now try to lock tokens (should fail due to insufficient balance)
    await expect(lockMint.connect(user2).lockMint(amount))
      .to.be.revertedWithCustomError(pumpBTC, "ERC20InsufficientBalance")
      .withArgs(user2.address, 0, amount);
  });

  it("should burn mintAsset and unlock lockAsset", async function () {
    const { lockMint, user1, pumpBTC, mintAsset, lockMintAddress } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);

    // User1 locks tokens first
    await lockMint.connect(user1).lockMint(amount);

    // Check balances before
    const initialLockAssetBalance = await pumpBTC.balanceOf(user1.address);
    const initialMintAssetBalance = await mintAsset.balanceOf(user1.address);

    // Call burnUnlock
    await expect(lockMint.connect(user1).burnUnlock(amount))
      .to.emit(lockMint, "Unlocked")
      .withArgs(user1.address, amount);

    // Check balances after
    expect(await pumpBTC.balanceOf(user1.address)).to.equal(initialLockAssetBalance + amount);
    expect(await mintAsset.balanceOf(user1.address)).to.equal(initialMintAssetBalance - amount);
    expect(await pumpBTC.balanceOf(lockMintAddress)).to.equal(0);
    expect(await mintAsset.balanceOf(user1.address)).to.equal(0);
  });

  it("should revert when amount is zero", async function () {
    const { lockMint, user1 } = await loadFixture(deployContracts);

    await expect(lockMint.connect(user1).burnUnlock(0)).to.be.revertedWith(
      "LockMint: Amount must be greater than zero"
    );
  });

  it("should revert when user has insufficient mintAsset", async function () {
    const { lockMint, user1, mintAsset } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);

    await expect(lockMint.connect(user1).burnUnlock(amount))
      .to.be.revertedWithCustomError(mintAsset, "ERC20InsufficientBalance")
      .withArgs(user1.address, 0, amount);
  });

  it("should allow owner to withdraw lockAsset", async function () {
    const { lockMint, owner, user1, pumpBTC, lockMintAddress } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);

    // User1 locks some tokens
    await lockMint.connect(user1).lockMint(amount);

    // Owner's initial balance
    const initialOwnerBalance = await pumpBTC.balanceOf(owner.address);

    // Owner calls emergencyWithdraw
    await expect(lockMint.connect(owner).emergencyWithdraw(amount))
      .to.emit(lockMint, "EmergencyWithdraw")
      .withArgs(owner.address, amount);

    // Check balances after
    expect(await pumpBTC.balanceOf(owner.address)).to.equal(initialOwnerBalance + amount);
    expect(await pumpBTC.balanceOf(lockMintAddress)).to.equal(0);
  });

  it("should revert when called by non-owner", async function () {
    const { lockMint, user1 } = await loadFixture(deployContracts);

    const amount = parseUnits("10", 8);

    await expect(lockMint.connect(user1).emergencyWithdraw(amount))
      .to.be.revertedWithCustomError(lockMint, "OwnableUnauthorizedAccount")
      .withArgs(user1.address);
  });

  it("should revert when amount is zero", async function () {
    const { lockMint, owner } = await loadFixture(deployContracts);

    await expect(lockMint.connect(owner).emergencyWithdraw(0)).to.be.revertedWith(
      "LockMint: Amount must be greater than zero"
    );
  });
});
