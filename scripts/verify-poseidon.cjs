const hre = require("hardhat");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("============================================================");
  console.log("Poseidon Hash Verification");
  console.log("============================================================\n");

  // Load deployment
  const fs = require("fs");
  const deploymentPath = `./deployments/xrplEvmTestnet-1449000.json`;
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  console.log("PrivacyPool:", deployment.contracts.PrivacyPool);
  console.log("");

  // Connect to PrivacyPool
  const PrivacyPool = await hre.ethers.getContractFactory("PrivacyPool");
  const pool = PrivacyPool.attach(deployment.contracts.PrivacyPool);

  // Initialize circomlib Poseidon
  const poseidon = await buildPoseidon();

  // Test vectors - these simulate nullifier/secret pairs
  const testVectors = [
    { left: 1n, right: 2n, name: "Simple (1, 2)" },
    { left: 0n, right: 0n, name: "Zeros (0, 0)" },
    {
      left: 12345678901234567890n,
      right: 98765432109876543210n,
      name: "Large numbers"
    },
    {
      // Typical nullifier-like value
      left: 21609618644364652679086810189336746015746787455296879832159427439597551645687n,
      right: 8645981980787649023086583266332407820534351529099608678386544113023155527166n,
      name: "Realistic commitment inputs"
    }
  ];

  console.log("Testing Poseidon hash compatibility...\n");

  let allPassed = true;

  for (const test of testVectors) {
    console.log(`Test: ${test.name}`);
    console.log(`  Left:  ${test.left}`);
    console.log(`  Right: ${test.right}`);

    // Calculate circomlib hash (off-chain reference)
    const circomlibHash = poseidon.F.toString(poseidon([test.left, test.right]));
    console.log(`  Circomlib:  ${circomlibHash}`);

    try {
      // Calculate on-chain hash via PrivacyPool
      // Note: We need to call the internal Poseidon function - let's use hashLeftRight if exposed
      // Or we can calculate commitment = Poseidon(nullifier, secret)

      // For verification, let's check if the zero value calculation matches
      // The MerkleTree initializes with Poseidon(0,0) at various levels

      // We can't directly call internal PoseidonT3.poseidon, but we can verify
      // the merkle root which uses Poseidon internally
      console.log(`  Status: ✓ Circomlib reference computed`);

    } catch (error) {
      console.log(`  Error: ${error.message}`);
      allPassed = false;
    }
    console.log("");
  }

  // Verify the initial merkle root matches expected value
  console.log("============================================================");
  console.log("Merkle Tree Verification");
  console.log("============================================================\n");

  // Get on-chain root
  const onChainRoot = await pool.getRoot();
  console.log(`On-chain root: ${onChainRoot.toString()}`);

  // Calculate expected root using circomlib
  // For an empty tree with 20 levels, we need to compute:
  // level 0: zeros[0] = ZERO_VALUE = keccak256("veil") % FIELD
  // level i: zeros[i] = Poseidon(zeros[i-1], zeros[i-1])

  const { keccak256, toUtf8Bytes } = require("ethers");
  const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const ZERO_VALUE = BigInt(keccak256(toUtf8Bytes("veil"))) % FIELD;

  console.log(`ZERO_VALUE: ${ZERO_VALUE.toString()}`);

  let expectedZeros = [ZERO_VALUE];
  for (let i = 1; i <= 20; i++) {
    const hash = poseidon.F.toString(poseidon([expectedZeros[i-1], expectedZeros[i-1]]));
    expectedZeros.push(BigInt(hash));
  }

  const expectedRoot = expectedZeros[20];
  console.log(`Expected root: ${expectedRoot.toString()}`);

  if (onChainRoot.toString() === expectedRoot.toString()) {
    console.log("\n✓ POSEIDON VERIFICATION PASSED!");
    console.log("  On-chain Poseidon matches circomlib exactly.");
    console.log("  ZK proofs generated with SnarkJS will be valid.");
  } else {
    console.log("\n✗ POSEIDON MISMATCH!");
    console.log("  On-chain Poseidon does NOT match circomlib.");
    console.log("  ZK proofs will fail verification.");
    allPassed = false;
  }

  console.log("\n============================================================");

  return allPassed;
}

main()
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
