/**
 * Deploy ONLY PrivacyPool to XRPL EVM Mainnet with 1 XRP denomination
 * Uses existing Verifier deployment to save gas
 *
 * Usage: npx hardhat run scripts/deploy-privacypool-only.cjs --network xrplEvmMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Existing Verifier from previous deployment
const EXISTING_VERIFIER = "0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13";

async function main() {
  console.log("=".repeat(60));
  console.log("PrivacyPool Deployment Only - 1 XRP Denomination");
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
  const tokenAddress = "0x0000000000000000000000000000000000000000"; // Native XRP

  console.log(`\nConfiguration:`);
  console.log(`  Denomination: 1 XRP`);
  console.log(`  Token: Native XRP (zero address)`);
  console.log(`  Using existing Verifier: ${EXISTING_VERIFIER}`);

  // Verify the existing verifier contract exists
  console.log("\n[1/2] Verifying existing Verifier contract...");
  const verifierCode = await hre.ethers.provider.getCode(EXISTING_VERIFIER);
  if (verifierCode === "0x") {
    console.error("  ❌ Verifier contract not found at address!");
    process.exit(1);
  }
  console.log(`  ✅ Verifier contract verified at: ${EXISTING_VERIFIER}`);

  // Estimate gas for PrivacyPool deployment
  console.log("\n[Estimating gas...]");
  const PrivacyPool = await hre.ethers.getContractFactory("PrivacyPool");
  const deployTx = await PrivacyPool.getDeployTransaction(
    EXISTING_VERIFIER,
    tokenAddress,
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
    console.error(`\n❌ Insufficient balance!`);
    console.error(`  Need: ${hre.ethers.formatEther(estimatedCost)} XRP`);
    console.error(`  Have: ${hre.ethers.formatEther(balance)} XRP`);
    console.error(`  Short by: ${hre.ethers.formatEther(estimatedCost - balance)} XRP`);
    process.exit(1);
  }

  // Deploy PrivacyPool
  console.log("\n[2/2] Deploying PrivacyPool...");
  const privacyPool = await PrivacyPool.deploy(
    EXISTING_VERIFIER,
    tokenAddress,
    denomination
  );
  await privacyPool.waitForDeployment();
  const privacyPoolAddress = await privacyPool.getAddress();
  console.log(`  PrivacyPool deployed at: ${privacyPoolAddress}`);

  // Verify deployment
  console.log("\n[Verification]");
  const poolInfo = await privacyPool.getPoolInfo();
  console.log(`  Denomination: ${hre.ethers.formatEther(poolInfo[0])} XRP`);
  console.log(`  Token: ${poolInfo[1]}`);
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
      wXRPToken: tokenAddress,
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
  const deploymentFile = path.join(deploymentsDir, `${networkName}-${chainId}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${deploymentFile}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE - 1 XRP DENOMINATION");
  console.log("=".repeat(60));
  console.log(`\nContracts:`);
  console.log(`  Verifier:    ${EXISTING_VERIFIER}`);
  console.log(`  PrivacyPool: ${privacyPoolAddress}`);

  console.log("\n⚠️  UPDATE REQUIRED:");
  console.log("  Update src/services/zkPool/indexer.ts with new PrivacyPool address");
  console.log("  Update src/services/orchestrator/index.ts preflight check");

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
