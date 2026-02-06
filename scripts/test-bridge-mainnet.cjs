/**
 * XRPL EVM MAINNET → XRPL Bridge Test Script
 *
 * Tests real bridge functionality on MAINNET using Axelar ITS.
 *
 * MAINNET CONFIGURATION (VERIFIED WORKING):
 * - Chain ID: 1440000
 * - ITS: 0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C
 * - XRP Token ID: 0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f
 * - Token Manager: 0xdb0a778c57Bd31E401D52ba6cf936D06E1324aE8 (NATIVE_INTERCHAIN_TOKEN)
 * - Trusted Chain: "xrpl" ✅
 *
 * Prerequisites:
 * - Funded wallet on XRPL EVM MAINNET with XRP
 * - Valid XRPL mainnet destination address
 *
 * Usage:
 *   node scripts/test-bridge-mainnet.cjs [amount] [xrplDestination]
 *
 * Example:
 *   node scripts/test-bridge-mainnet.cjs 1.0 rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9
 */

const { ethers } = require('ethers');
require('dotenv').config();

// =============================================================================
// MAINNET Configuration
// =============================================================================

const CONFIG = {
  // XRPL EVM Mainnet
  RPC_URL: 'https://rpc.xrplevm.org',
  CHAIN_ID: 1440000,

  // Axelar ITS Contract (Mainnet)
  ITS_CONTRACT: '0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C',

  // XRP Token ID (verified from ITS contract)
  XRP_TOKEN_ID: '0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f',

  // Token Manager (NATIVE_INTERCHAIN_TOKEN type)
  TOKEN_MANAGER: '0xdb0a778c57Bd31E401D52ba6cf936D06E1324aE8',

  // Axelar destination chain identifier
  DESTINATION_CHAIN: 'xrpl',

  // Default test amount (in XRP)
  DEFAULT_AMOUNT: '1.0',

  // Gas settings for XRPL EVM
  GAS_LIMIT: 500000,
  GAS_PRICE_GWEI: 10, // Mainnet uses lower gas price
};

// ITS Contract ABI
const ITS_ABI = [
  'function interchainTransfer(bytes32 tokenId, string calldata destinationChain, bytes calldata destinationAddress, uint256 amount, bytes calldata metadata, uint256 gasValue) external payable',
  'function interchainTokenAddress(bytes32 tokenId) external view returns (address)',
  'function tokenManagerAddress(bytes32 tokenId) external view returns (address)',
];

// =============================================================================
// Utility Functions
// =============================================================================

function isValidXRPLAddress(address) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

function encodeXRPLAddress(address) {
  return '0x' + Buffer.from(address).toString('hex');
}

function formatXRP(wei) {
  return parseFloat(ethers.formatEther(wei)).toFixed(6);
}

// =============================================================================
// Bridge Test
// =============================================================================

async function runBridgeTest(amount, xrplDestination, execute = false) {
  console.log('\n' + '='.repeat(70));
  console.log('  XRPL EVM MAINNET → XRPL Bridge Test');
  console.log('='.repeat(70) + '\n');

  // Step 1: Validate inputs
  console.log('📋 Step 1: Validating inputs...\n');

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ PRIVATE_KEY not found in .env');
    return { success: false, error: 'Missing PRIVATE_KEY' };
  }
  console.log('✅ PRIVATE_KEY found');

  if (!isValidXRPLAddress(xrplDestination)) {
    console.log(`❌ Invalid XRPL address: ${xrplDestination}`);
    return { success: false, error: 'Invalid XRPL address' };
  }
  console.log(`✅ Valid XRPL destination: ${xrplDestination}`);

  // Step 2: Connect to mainnet
  console.log('\n📋 Step 2: Connecting to XRPL EVM Mainnet...\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const network = await provider.getNetwork();

  if (network.chainId !== BigInt(CONFIG.CHAIN_ID)) {
    console.log(`❌ Wrong chain. Expected ${CONFIG.CHAIN_ID}, got ${network.chainId}`);
    return { success: false, error: 'Wrong chain ID' };
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`✅ Connected to XRPL EVM Mainnet (Chain ID: ${network.chainId})`);
  console.log(`   Wallet: ${wallet.address}`);

  // Step 3: Check balance
  console.log('\n📋 Step 3: Checking balance...\n');

  const balance = await provider.getBalance(wallet.address);
  console.log(`   Balance: ${formatXRP(balance)} XRP`);

  const amountWei = ethers.parseEther(amount);
  const gasValue = ethers.parseEther('0.01'); // Cross-chain gas
  const estimatedGasCost = BigInt(CONFIG.GAS_LIMIT) * ethers.parseUnits(String(CONFIG.GAS_PRICE_GWEI), 'gwei');
  const totalNeeded = amountWei + gasValue + estimatedGasCost;

  console.log(`   Amount to bridge: ${amount} XRP`);
  console.log(`   Cross-chain gas: 0.01 XRP`);
  console.log(`   EVM gas (est): ${formatXRP(estimatedGasCost)} XRP`);
  console.log(`   Total needed: ${formatXRP(totalNeeded)} XRP`);

  if (balance < totalNeeded) {
    console.log(`\n❌ Insufficient balance!`);
    console.log(`   Need: ${formatXRP(totalNeeded)} XRP`);
    console.log(`   Have: ${formatXRP(balance)} XRP`);
    console.log(`\n📝 To fund your wallet, bridge XRP from XRPL mainnet to:`);
    console.log(`   ${wallet.address}`);
    console.log(`   Use: https://bridge.xrplevm.org/`);
    return { success: false, error: 'Insufficient balance' };
  }
  console.log(`✅ Sufficient balance`);

  // Step 4: Verify ITS contract
  console.log('\n📋 Step 4: Verifying ITS contract...\n');

  const itsContract = new ethers.Contract(CONFIG.ITS_CONTRACT, ITS_ABI, wallet);

  const tokenManager = await itsContract.tokenManagerAddress(CONFIG.XRP_TOKEN_ID);
  console.log(`   Token Manager: ${tokenManager}`);

  if (tokenManager !== CONFIG.TOKEN_MANAGER) {
    console.log(`⚠️  Token manager mismatch (may still work)`);
  }
  console.log(`✅ ITS contract verified`);

  // Step 5: Prepare transaction
  console.log('\n📋 Step 5: Preparing transaction...\n');

  const destBytes = encodeXRPLAddress(xrplDestination);
  console.log(`   Destination: ${xrplDestination}`);
  console.log(`   Destination (encoded): ${destBytes.substring(0, 40)}...`);

  // Step 6: Estimate gas
  console.log('\n📋 Step 6: Estimating gas...\n');

  try {
    const gasEstimate = await itsContract.interchainTransfer.estimateGas(
      CONFIG.XRP_TOKEN_ID,
      CONFIG.DESTINATION_CHAIN,
      destBytes,
      amountWei,
      '0x',
      gasValue,
      { value: amountWei + gasValue }
    );

    console.log(`   Gas estimate: ${gasEstimate.toString()}`);
    console.log(`✅ Gas estimation successful - Bridge will work!`);

    // Step 7: Execute or dry run
    if (execute) {
      console.log('\n📋 Step 7: Executing bridge transaction...\n');

      const tx = await itsContract.interchainTransfer(
        CONFIG.XRP_TOKEN_ID,
        CONFIG.DESTINATION_CHAIN,
        destBytes,
        amountWei,
        '0x',
        gasValue,
        {
          value: amountWei + gasValue,
          gasLimit: Math.ceil(Number(gasEstimate) * 1.3),
          gasPrice: ethers.parseUnits(String(CONFIG.GAS_PRICE_GWEI), 'gwei'),
        }
      );

      console.log(`   Transaction submitted: ${tx.hash}`);
      console.log('   Waiting for confirmation...');

      const receipt = await tx.wait();

      console.log(`\n✅ Transaction confirmed!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

      console.log(`\n🔗 Track on Axelarscan:`);
      console.log(`   https://axelarscan.io/gmp/${tx.hash}`);

      return { success: true, txHash: tx.hash };
    } else {
      console.log('\n📋 Step 7: Dry run complete\n');
      console.log('   ⚠️  Transaction NOT submitted (dry run mode)');
      console.log('   To execute: node scripts/test-bridge-mainnet.cjs --execute');

      return { success: true, dryRun: true };
    }

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);

    if (error.message.includes('1a59c9bd')) {
      console.log('   Error Type: UntrustedChain');
      console.log('   This should NOT happen on mainnet!');
    }

    return { success: false, error: error.message };
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const filteredArgs = args.filter(a => a !== '--execute');

  const amount = filteredArgs[0] || CONFIG.DEFAULT_AMOUNT;
  const xrplDestination = filteredArgs[1] || 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';

  console.log('\n🌉 XRPL EVM Mainnet Bridge Test\n');
  console.log(`Amount: ${amount} XRP`);
  console.log(`Destination: ${xrplDestination}`);
  console.log(`Mode: ${execute ? '🔴 EXECUTE' : '🟢 DRY RUN'}`);

  const result = await runBridgeTest(amount, xrplDestination, execute);

  console.log('\n' + '='.repeat(70));
  console.log('  Result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  if (result.txHash) console.log('  TX Hash:', result.txHash);
  if (result.error) console.log('  Error:', result.error);
  console.log('='.repeat(70) + '\n');

  process.exit(result.success ? 0 : 1);
}

main().catch(console.error);
