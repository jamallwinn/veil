/**
 * Deploy PrivacyPoolNative to XRPL EVM Mainnet for native XRP deposits
 * Uses existing Verifier deployment to save gas
 *
 * Usage: npx hardhat run scripts/deploy-privacypool-native.cjs --network xrplEvmMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Existing Verifier from previous deployment
const EXISTING_VERIFIER = "0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13";

async function main() {
  console.log("=".repeat(60));
  console.log("PrivacyPoolNative Deployment - Native XRP (1 XRP Denomination)");
  console.log("=".repeat(60));

  // Get network info
  const networkName = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log(`\nNetwork: ${networkName}`);
  console.log(`Chain ID: ${chainId}`);

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} XRP`);

  if (balance === 0n) {
    console.error("\nError: Deployer has no balance!");
    process.exit(1);
  }

  // Configuration - 1 XRP denomination for MVP/demo
  const denomination = hre.ethers.parseEther("1"); // 1 XRP

  console.log(`\nConfiguration:`);
  console.log(`  Denomination: 1 XRP`);
  console.log(`  Token: Native XRP (handled via msg.value)`);
  console.log(`  Using existing Verifier: ${EXISTING_VERIFIER}`);

  // Verify the existing verifier contract exists
  console.log("\n[1/2] Verifying existing Verifier contract...");
  const verifierCode = await hre.ethers.provider.getCode(EXISTING_VERIFIER);
  if (verifierCode === "0x") {
    console.error("  Error: Verifier contract not found at address!");
    process.exit(1);
  }
  console.log(`  Verifier contract verified at: ${EXISTING_VERIFIER}`);

  // Get contract factory for PrivacyPoolNative
  console.log("\n[Estimating gas...]");
  const PrivacyPoolNative = await hre.ethers.getContractFactory("PrivacyPoolNative");
  const deployTx = await PrivacyPoolNative.getDeployTransaction(
    EXISTING_VERIFIER,
    denomination
  );
  const gasEstimate = await hre.ethers.provider.estimateGas({
    from: deployer.address,
    data: deployTx.data,
  });
  const feeData = await hre.ethers.provider.getFeeData();
  const estimatedCost = gasEstimate * feeData.gasPrice;
  console.log(`  Gas estimate: ${gasEstimate.toString()}`);
  console.log(`  Estimated cost: ${hre.ethers.formatEther(estimatedCost)} XRP`);

  if (balance < estimatedCost) {
    console.error(`\nInsufficient balance!`);
    console.error(`  Need: ${hre.ethers.formatEther(estimatedCost)} XRP`);
    console.error(`  Have: ${hre.ethers.formatEther(balance)} XRP`);
    console.error(`  Short by: ${hre.ethers.formatEther(estimatedCost - balance)} XRP`);
    process.exit(1);
  }

  // Deploy PrivacyPoolNative
  console.log("\n[2/2] Deploying PrivacyPoolNative...");
  const privacyPool = await PrivacyPoolNative.deploy(
    EXISTING_VERIFIER,
    denomination
  );
  await privacyPool.waitForDeployment();
  const privacyPoolAddress = await privacyPool.getAddress();
  console.log(`  PrivacyPoolNative deployed at: ${privacyPoolAddress}`);

  // Verify deployment
  console.log("\n[Verification]");
  const poolInfo = await privacyPool.getPoolInfo();
  console.log(`  Denomination: ${hre.ethers.formatEther(poolInfo[0])} XRP`);
  console.log(`  Token: ${poolInfo[1]} (0xEeee... = native)`);
  console.log(`  Verifier: ${poolInfo[2]}`);
  console.log(`  Leaf Count: ${poolInfo[3]}`);

  // Save deployment info
  const deployment = {
    network: networkName,
    chainId: chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      Verifier: EXISTING_VERIFIER,
      PrivacyPool: privacyPoolAddress,
      // Native token indicator
      tokenType: "native",
    },
    config: {
      denomination: denomination.toString(),
      treeLevels: 20,
      rootHistorySize: 30,
    },
  };

  // Save deployment file
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const deploymentFile = path.join(deploymentsDir, `${networkName}-${chainId}-native.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${deploymentFile}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE - PrivacyPoolNative");
  console.log("=".repeat(60));
  console.log(`\nContracts:`);
  console.log(`  Verifier:          ${EXISTING_VERIFIER}`);
  console.log(`  PrivacyPoolNative: ${privacyPoolAddress}`);

  console.log("\n** UPDATE REQUIRED **:");
  console.log("  1. Update src/services/contracts/privacyPool.ts:");
  console.log(`     contractAddress: '${privacyPoolAddress}'`);
  console.log("  2. Ensure deposit() sends msg.value for native XRP");

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
