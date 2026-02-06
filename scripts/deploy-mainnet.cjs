/**
 * Deploy Privacy Pool to XRPL EVM Mainnet with 1 XRP denomination
 *
 * Usage: npx hardhat run scripts/deploy-mainnet.cjs --network xrplEvmMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=".repeat(60));
  console.log("Veil Privacy Pool Deployment - 1 XRP Denomination");
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

  // Step 1: Deploy Verifier
  console.log("\n[1/2] Deploying Groth16Verifier...");
  const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`  Verifier deployed at: ${verifierAddress}`);

  // Step 2: Deploy PrivacyPool
  console.log("\n[2/2] Deploying PrivacyPool...");
  const PrivacyPool = await hre.ethers.getContractFactory("PrivacyPool");
  const privacyPool = await PrivacyPool.deploy(
    verifierAddress,
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
      Verifier: verifierAddress,
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
  console.log(`  Verifier:    ${verifierAddress}`);
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
