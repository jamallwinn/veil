const hre = require("hardhat");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  console.log("Deploying TestPoseidon to local hardhat network...\n");

  const TestPoseidon = await hre.ethers.getContractFactory("TestPoseidon");
  const testPoseidon = await TestPoseidon.deploy();
  await testPoseidon.waitForDeployment();

  console.log("TestPoseidon deployed at:", await testPoseidon.getAddress());

  // Initialize circomlib Poseidon
  const poseidon = await buildPoseidon();

  const testCases = [
    [0n, 0n],
    [1n, 2n],
    [123n, 456n],
  ];

  console.log("\n=== Comparing Poseidon Outputs ===\n");

  for (const [left, right] of testCases) {
    const circomlibResult = poseidon.F.toString(poseidon([left, right]));
    const onChainResult = await testPoseidon.testHash(left, right);

    const match = circomlibResult === onChainResult.toString();

    console.log(`Poseidon(${left}, ${right}):`);
    console.log(`  Circomlib: ${circomlibResult}`);
    console.log(`  On-chain:  ${onChainResult.toString()}`);
    console.log(`  Match: ${match ? "✓ YES" : "✗ NO"}`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
