const hre = require("hardhat");
const ethers = hre.ethers;
const fs = require("fs");
const path = require("path");

/**
 * Veil Privacy Pool Deployment Script
 *
 * Deploys:
 * 1. Groth16Verifier - ZK proof verification
 * 2. PrivacyPool - Main privacy pool contract
 *
 * Usage:
 * npx hardhat run scripts/deploy.cjs --network xrplEvmTestnet
 */

// Deployment configuration per network
const networkConfigs = {
  // XRPL EVM Testnet (Chain ID: 1449000)
  xrplEvmTestnet: {
    wXRPToken: "0x0000000000000000000000000000000000000000", // Native XRP as gas
    denomination: ethers.parseEther("5"), // 5 XRP
    name: "XRPL EVM Testnet (1449000)",
  },
  // XRPL EVM Devnet (Chain ID: 1440002)
  xrplEvmDevnet: {
    wXRPToken: "0x0000000000000000000000000000000000000000", // Native XRP as gas
    denomination: ethers.parseEther("5"), // 5 XRP
    name: "XRPL EVM Devnet (1440002)",
  },
  // XRPL EVM Mainnet (Chain ID: 1440000)
  xrplEvmMainnet: {
    wXRPToken: "0x0000000000000000000000000000000000000000", // Native XRP as gas
    denomination: ethers.parseEther("5"), // 5 XRP
    name: "XRPL EVM Mainnet (1440000)",
  },
  // Local Hardhat
  hardhat: {
    wXRPToken: "0x0000000000000000000000000000000000000000", // Will deploy mock
    denomination: ethers.parseEther("5"), // 5 XRP
    name: "Hardhat Local",
  },
  localhost: {
    wXRPToken: "0x0000000000000000000000000000000000000000", // Will deploy mock
    denomination: ethers.parseEther("5"), // 5 XRP
    name: "Localhost",
  },
};

async function main() {
  console.log("=".repeat(60));
  console.log("Veil Privacy Pool Deployment");
  console.log("=".repeat(60));

  // Get network info
  const networkName = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`\nNetwork: ${networkName}`);
  console.log(`Chain ID: ${chainId}`);

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} XRP`);

  if (balance === 0n) {
    console.error("\nError: Deployer has no balance!");
    console.log("Get testnet XRP from: https://faucet.xrpl-evm.peersyst.tech");
    process.exit(1);
  }

  // Get config
  const config = networkConfigs[networkName];
  if (!config) {
    console.error(`\nError: No config for network: ${networkName}`);
    console.log("Available networks:", Object.keys(networkConfigs).join(", "));
    process.exit(1);
  }

  console.log(`\nConfiguration:`);
  console.log(`  Network Name: ${config.name}`);
  console.log(`  Denomination: ${ethers.formatEther(config.denomination)} XRP`);
  console.log(`  wXRP Token: ${config.wXRPToken}`);

  // Deploy mock token for local testing
  let tokenAddress = config.wXRPToken;
  if (
    (networkName === "hardhat" || networkName === "localhost") &&
    tokenAddress === "0x0000000000000000000000000000000000000000"
  ) {
    console.log("\n[1/3] Deploying Mock wXRP Token...");
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockToken.deploy("Wrapped XRP", "wXRP", 18);
    await mockToken.waitForDeployment();
    tokenAddress = await mockToken.getAddress();
    console.log(`  MockERC20 deployed at: ${tokenAddress}`);
  }

  // Step 1: Deploy Verifier
  console.log("\n[2/3] Deploying Groth16Verifier...");
  const Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`  Verifier deployed at: ${verifierAddress}`);

  // Step 2: Deploy PrivacyPool
  console.log("\n[3/3] Deploying PrivacyPool...");
  const PrivacyPool = await ethers.getContractFactory("PrivacyPool");
  const privacyPool = await PrivacyPool.deploy(
    verifierAddress,
    tokenAddress,
    config.denomination
  );
  await privacyPool.waitForDeployment();
  const privacyPoolAddress = await privacyPool.getAddress();
  console.log(`  PrivacyPool deployed at: ${privacyPoolAddress}`);

  // Verify deployment
  console.log("\n[Verification]");
  const poolInfo = await privacyPool.getPoolInfo();
  console.log(`  Denomination: ${ethers.formatEther(poolInfo[0])} XRP`);
  console.log(`  Token: ${poolInfo[1]}`);
  console.log(`  Verifier: ${poolInfo[2]}`);
  console.log(`  Leaf Count: ${poolInfo[3]}`);
  console.log(`  Current Root: ${poolInfo[4]}`);

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
      denomination: config.denomination.toString(),
      treeLevels: 20,
      rootHistorySize: 30,
    },
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment file
  const deploymentFile = path.join(
    deploymentsDir,
    `${networkName}-${chainId}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${deploymentFile}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nContracts:`);
  console.log(`  Verifier:    ${verifierAddress}`);
  console.log(`  PrivacyPool: ${privacyPoolAddress}`);
  console.log(`  wXRP Token:  ${tokenAddress}`);

  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log(`\nVerify contracts on explorer:`);
    console.log(
      `  npx hardhat verify --network ${networkName} ${verifierAddress}`
    );
    console.log(
      `  npx hardhat verify --network ${networkName} ${privacyPoolAddress} ${verifierAddress} ${tokenAddress} ${config.denomination}`
    );
  }

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
