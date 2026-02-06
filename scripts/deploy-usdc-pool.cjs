const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * USDC Privacy Pool Deployment Script
 *
 * Deploys a PrivacyPool contract configured for USDC.xrpl token.
 * Reuses the existing Groth16Verifier (same ZK circuit works for any denomination).
 *
 * Key differences from XRP pool:
 * - Uses USDC.xrpl ERC-20 token instead of native XRP
 * - 100 USDC denomination (with 15 decimals on EVM)
 * - Requires users to approve USDC before deposit
 *
 * Usage:
 * npx hardhat run scripts/deploy-usdc-pool.cjs --network xrplEvmMainnet
 */

// =============================================================================
// USDC Configuration (VERIFIED ON-CHAIN DATA)
// =============================================================================

const USDC_CONFIG = {
  // USDC.xrpl ERC-20 contract on XRPL EVM Mainnet
  TOKEN_ADDRESS: "0xDaF4556169c4F3f2231d8ab7BC8772Ddb7D4c84C",
  // USDC has 15 decimals on XRPL EVM
  DECIMALS: 15,
  // Pool denomination: 3 USDC = 3 * 10^15
  DENOMINATION: BigInt("3000000000000000"),
  // Existing Groth16Verifier (same circuit works for any denomination)
  VERIFIER_ADDRESS: "0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13",
};

// Network-specific configurations
const networkConfigs = {
  // XRPL EVM Mainnet (Chain ID: 1440000) - PRODUCTION
  xrplEvmMainnet: {
    usdcToken: USDC_CONFIG.TOKEN_ADDRESS,
    verifier: USDC_CONFIG.VERIFIER_ADDRESS,
    denomination: USDC_CONFIG.DENOMINATION,
    name: "XRPL EVM Mainnet",
  },
  // XRPL EVM Testnet (Chain ID: 1449000)
  xrplEvmTestnet: {
    usdcToken: USDC_CONFIG.TOKEN_ADDRESS, // Same address - verify on testnet
    verifier: USDC_CONFIG.VERIFIER_ADDRESS, // Reuse mainnet verifier or deploy new
    denomination: USDC_CONFIG.DENOMINATION,
    name: "XRPL EVM Testnet",
  },
  // Local Hardhat for testing
  hardhat: {
    usdcToken: "0x0000000000000000000000000000000000000000", // Will deploy mock
    verifier: "0x0000000000000000000000000000000000000000", // Will deploy new
    denomination: USDC_CONFIG.DENOMINATION,
    name: "Hardhat Local",
  },
  localhost: {
    usdcToken: "0x0000000000000000000000000000000000000000", // Will deploy mock
    verifier: "0x0000000000000000000000000000000000000000", // Will deploy new
    denomination: USDC_CONFIG.DENOMINATION,
    name: "Localhost",
  },
};

async function main() {
  console.log("=".repeat(60));
  console.log("USDC Privacy Pool Deployment");
  console.log("=".repeat(60));

  // Get network info
  const networkName = network.name;
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

  // Calculate human-readable denomination
  const denominationHuman =
    Number(config.denomination) / 10 ** USDC_CONFIG.DECIMALS;

  console.log(`\nConfiguration:`);
  console.log(`  Network Name: ${config.name}`);
  console.log(`  Denomination: ${denominationHuman} USDC`);
  console.log(`  USDC Token: ${config.usdcToken}`);
  console.log(`  Verifier: ${config.verifier}`);

  // For local testing, deploy mock contracts
  let tokenAddress = config.usdcToken;
  let verifierAddress = config.verifier;

  if (networkName === "hardhat" || networkName === "localhost") {
    // Deploy mock USDC token
    if (tokenAddress === "0x0000000000000000000000000000000000000000") {
      console.log("\n[1/3] Deploying Mock USDC Token...");
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "USDC.xrpl",
        "USDC",
        USDC_CONFIG.DECIMALS
      );
      await mockToken.waitForDeployment();
      tokenAddress = await mockToken.getAddress();
      console.log(`  MockUSDC deployed at: ${tokenAddress}`);
    }

    // Deploy verifier if not using existing
    if (verifierAddress === "0x0000000000000000000000000000000000000000") {
      console.log("\n[2/3] Deploying Groth16Verifier...");
      const Verifier = await ethers.getContractFactory("Groth16Verifier");
      const verifier = await Verifier.deploy();
      await verifier.waitForDeployment();
      verifierAddress = await verifier.getAddress();
      console.log(`  Verifier deployed at: ${verifierAddress}`);
    }
  } else {
    console.log("\n[1/3] Using existing USDC token...");
    console.log(`  Token: ${tokenAddress}`);

    console.log("\n[2/3] Using existing Groth16Verifier...");
    console.log(`  Verifier: ${verifierAddress}`);

    // Verify the verifier contract exists
    const verifierCode = await ethers.provider.getCode(verifierAddress);
    if (verifierCode === "0x") {
      console.error(
        "\nError: Verifier contract not found at specified address!"
      );
      console.log(
        "Run the standard deploy.ts first to deploy the Groth16Verifier."
      );
      process.exit(1);
    }
    console.log("  Verifier contract verified ✓");

    // Verify the USDC token contract exists
    const tokenCode = await ethers.provider.getCode(tokenAddress);
    if (tokenCode === "0x") {
      console.error("\nError: USDC token contract not found at specified address!");
      process.exit(1);
    }
    console.log("  USDC token contract verified ✓");
  }

  // Deploy USDC PrivacyPool
  console.log("\n[3/3] Deploying USDC PrivacyPool...");
  const PrivacyPool = await ethers.getContractFactory("PrivacyPool");
  const usdcPrivacyPool = await PrivacyPool.deploy(
    verifierAddress,
    tokenAddress,
    config.denomination
  );
  await usdcPrivacyPool.waitForDeployment();
  const privacyPoolAddress = await usdcPrivacyPool.getAddress();
  console.log(`  USDC PrivacyPool deployed at: ${privacyPoolAddress}`);

  // Verify deployment
  console.log("\n[Verification]");
  const poolInfo = await usdcPrivacyPool.getPoolInfo();
  const poolDenominationHuman =
    Number(poolInfo[0]) / 10 ** USDC_CONFIG.DECIMALS;

  console.log(`  Denomination: ${poolDenominationHuman} USDC`);
  console.log(`  Token: ${poolInfo[1]}`);
  console.log(`  Verifier: ${poolInfo[2]}`);
  console.log(`  Leaf Count: ${poolInfo[3]}`);
  console.log(`  Current Root: ${poolInfo[4]}`);

  // Verify token matches expected
  if (poolInfo[1].toLowerCase() !== tokenAddress.toLowerCase()) {
    console.error("\nWarning: Token address mismatch!");
  }

  // Save deployment info
  const deployment = {
    network: networkName,
    chainId: chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    type: "USDC_PRIVACY_POOL",
    contracts: {
      Verifier: verifierAddress,
      PrivacyPool: privacyPoolAddress,
      USDCToken: tokenAddress,
    },
    config: {
      denomination: config.denomination.toString(),
      denominationHuman: `${denominationHuman} USDC`,
      decimals: USDC_CONFIG.DECIMALS,
      treeLevels: 20,
      rootHistorySize: 30,
    },
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment file with USDC prefix
  const deploymentFile = path.join(
    deploymentsDir,
    `usdc-pool-${networkName}-${chainId}.json`
  );
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: ${deploymentFile}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("USDC PRIVACY POOL DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nContracts:`);
  console.log(`  Verifier:         ${verifierAddress}`);
  console.log(`  USDC PrivacyPool: ${privacyPoolAddress}`);
  console.log(`  USDC Token:       ${tokenAddress}`);
  console.log(`  Denomination:     ${denominationHuman} USDC`);

  // Update instructions
  console.log(`\n[NEXT STEPS]`);
  console.log(`1. Update src/constants/usdc.ts with:`);
  console.log(`   USDC_PRIVACY_POOL_ADDRESS = '${privacyPoolAddress}'`);
  console.log(`\n2. Verify contracts on explorer (if on mainnet/testnet):`);
  console.log(
    `   npx hardhat verify --network ${networkName} ${privacyPoolAddress} ${verifierAddress} ${tokenAddress} ${config.denomination}`
  );

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
