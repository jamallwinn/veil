const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PrivacyPool", function () {
  // Fixture to deploy contracts
  async function deployPrivacyPoolFixture() {
    const [owner, user1, user2, relayer] = await ethers.getSigners();

    // Deploy mock wXRP token
    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy("Wrapped XRP", "wXRP", 18);

    // Deploy Verifier
    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();

    // Deploy PrivacyPool with 100 XRP denomination
    const denomination = ethers.parseEther("100");
    const PrivacyPool = await ethers.getContractFactory("PrivacyPool");
    const privacyPool = await PrivacyPool.deploy(
      await verifier.getAddress(),
      await token.getAddress(),
      denomination
    );

    // Mint tokens to users for testing
    await token.mint(user1.address, ethers.parseEther("1000"));
    await token.mint(user2.address, ethers.parseEther("1000"));

    return { privacyPool, verifier, token, owner, user1, user2, relayer, denomination };
  }

  describe("Deployment", function () {
    it("Should set the correct verifier", async function () {
      const { privacyPool, verifier } = await loadFixture(deployPrivacyPoolFixture);
      const poolInfo = await privacyPool.getPoolInfo();
      expect(poolInfo[2]).to.equal(await verifier.getAddress());
    });

    it("Should set the correct token", async function () {
      const { privacyPool, token } = await loadFixture(deployPrivacyPoolFixture);
      const poolInfo = await privacyPool.getPoolInfo();
      expect(poolInfo[1]).to.equal(await token.getAddress());
    });

    it("Should set the correct denomination", async function () {
      const { privacyPool, denomination } = await loadFixture(deployPrivacyPoolFixture);
      const poolInfo = await privacyPool.getPoolInfo();
      expect(poolInfo[0]).to.equal(denomination);
    });

    it("Should initialize with empty tree", async function () {
      const { privacyPool } = await loadFixture(deployPrivacyPoolFixture);
      const poolInfo = await privacyPool.getPoolInfo();
      expect(poolInfo[3]).to.equal(0); // leaf count
    });

    it("Should reject zero denomination", async function () {
      const { verifier, token } = await loadFixture(deployPrivacyPoolFixture);
      const PrivacyPool = await ethers.getContractFactory("PrivacyPool");
      await expect(
        PrivacyPool.deploy(await verifier.getAddress(), await token.getAddress(), 0)
      ).to.be.revertedWithCustomError(PrivacyPool, "InvalidDenomination");
    });
  });

  describe("Deposit", function () {
    it("Should accept a valid deposit", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      // Generate a test commitment (in real usage this is Poseidon(nullifier, secret))
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("test-commitment-1"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

      // Approve tokens
      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);

      // Deposit
      await expect(privacyPool.connect(user1).deposit(commitmentBn))
        .to.emit(privacyPool, "Deposit");

      // Verify state
      expect(await privacyPool.getLeafCount()).to.equal(1);
      expect(await privacyPool.isCommitmentExists(commitmentBn)).to.be.true;
    });

    it("Should reject duplicate commitment", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const commitment = ethers.keccak256(ethers.toUtf8Bytes("test-commitment-dup"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

      // First deposit
      await token.connect(user1).approve(await privacyPool.getAddress(), denomination * 2n);
      await privacyPool.connect(user1).deposit(commitmentBn);

      // Second deposit with same commitment should fail
      await expect(
        privacyPool.connect(user1).deposit(commitmentBn)
      ).to.be.revertedWithCustomError(privacyPool, "CommitmentAlreadyExists");
    });

    it("Should reject zero commitment", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);

      await expect(
        privacyPool.connect(user1).deposit(0)
      ).to.be.revertedWithCustomError(privacyPool, "InvalidProof");
    });

    it("Should transfer tokens on deposit", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const commitment = ethers.keccak256(ethers.toUtf8Bytes("test-transfer"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

      const balanceBefore = await token.balanceOf(user1.address);
      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);
      await privacyPool.connect(user1).deposit(commitmentBn);
      const balanceAfter = await token.balanceOf(user1.address);

      expect(balanceBefore - balanceAfter).to.equal(denomination);
      expect(await token.balanceOf(await privacyPool.getAddress())).to.equal(denomination);
    });
  });

  describe("Merkle Tree", function () {
    it("Should update root after deposit", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const rootBefore = await privacyPool.getRoot();

      const commitment = ethers.keccak256(ethers.toUtf8Bytes("test-root-update"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);
      await privacyPool.connect(user1).deposit(commitmentBn);

      const rootAfter = await privacyPool.getRoot();
      expect(rootAfter).to.not.equal(rootBefore);
    });

    it("Should store roots in history", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const root1 = await privacyPool.getRoot();

      // Make a deposit
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("test-history"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);
      await privacyPool.connect(user1).deposit(commitmentBn);

      const root2 = await privacyPool.getRoot();

      // Both roots should be known
      expect(await privacyPool.isKnownRoot(root1)).to.be.true;
      expect(await privacyPool.isKnownRoot(root2)).to.be.true;
    });

    it("Should reject unknown root", async function () {
      const { privacyPool } = await loadFixture(deployPrivacyPoolFixture);
      const fakeRoot = ethers.keccak256(ethers.toUtf8Bytes("fake-root"));
      expect(await privacyPool.isKnownRoot(fakeRoot)).to.be.false;
    });
  });

  describe("Pool Info", function () {
    it("Should return correct pool information", async function () {
      const { privacyPool, verifier, token, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const poolInfo = await privacyPool.getPoolInfo();

      expect(poolInfo[0]).to.equal(denomination); // denomination
      expect(poolInfo[1]).to.equal(await token.getAddress()); // token
      expect(poolInfo[2]).to.equal(await verifier.getAddress()); // verifier
      expect(poolInfo[3]).to.equal(0); // leaf count
      expect(poolInfo[4]).to.not.equal(0); // root (not zero)
    });
  });

  describe("Gas Estimation", function () {
    it("Deposit should use reasonable gas", async function () {
      const { privacyPool, token, user1, denomination } = await loadFixture(
        deployPrivacyPoolFixture
      );

      const commitment = ethers.keccak256(ethers.toUtf8Bytes("gas-test"));
      const commitmentBn = BigInt(commitment) % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

      await token.connect(user1).approve(await privacyPool.getAddress(), denomination);

      const tx = await privacyPool.connect(user1).deposit(commitmentBn);
      const receipt = await tx.wait();

      console.log(`  Deposit gas used: ${receipt.gasUsed}`);
      // Note: Gas is higher with placeholder Poseidon (keccak256-based)
      // With real circomlib Poseidon, expect ~120k gas
      expect(receipt.gasUsed).to.be.lessThan(350000n);
    });
  });

  describe("Nullifier Tracking", function () {
    it("Should track spent nullifiers correctly", async function () {
      const { privacyPool } = await loadFixture(deployPrivacyPoolFixture);

      const nullifierHash = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier"));

      // Initially should not be spent
      expect(await privacyPool.isSpent(nullifierHash)).to.be.false;
    });
  });
});
