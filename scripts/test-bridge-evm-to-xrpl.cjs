/**
 * XRPL EVM → XRPL Bridge Test Script
 *
 * Tests real bridge functionality using Axelar ITS on XRPL EVM Testnet.
 *
 * Prerequisites:
 * - Funded wallet on XRPL EVM Testnet (set PRIVATE_KEY in .env)
 * - Valid XRPL testnet destination address
 *
 * Usage:
 *   node scripts/test-bridge-evm-to-xrpl.cjs [amount] [xrplDestination]
 *
 * Example:
 *   node scripts/test-bridge-evm-to-xrpl.cjs 1.0 rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9
 *
 * @see https://docs.xrplevm.org/pages/bridge/interchain-transfer
 */

const { ethers } = require('ethers');
require('dotenv').config();

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // XRPL EVM Testnet
  RPC_URL: 'https://rpc.testnet.xrplevm.org',
  CHAIN_ID: 1449000,

  // Axelar ITS Contract (Testnet)
  ITS_CONTRACT: '0x3b1ca8B18698409fF95e29c506ad7014980F0193',

  // XRP Token ID (verified from ITS contract)
  XRP_TOKEN_ID: '0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f',

  // XRP Token Contract Address (for balance checks)
  XRP_TOKEN_ADDRESS: '0xA2763fb2290E3E4F372F36796db29C6c564402d9',

  // Axelar destination chain identifier
  DESTINATION_CHAIN: 'xrpl',

  // Default test amount (in XRP)
  DEFAULT_AMOUNT: '0.1',

  // Gas settings
  GAS_LIMIT: 500000,
  GAS_PRICE_GWEI: 300, // XRPL EVM Testnet requires ~275+ gwei
};

// ITS Contract ABI (minimal for interchainTransfer)
const ITS_ABI = [
  'function interchainTransfer(bytes32 tokenId, string calldata destinationChain, bytes calldata destinationAddress, uint256 amount, bytes calldata metadata, uint256 gasValue) external payable',
  'function interchainTokenAddress(bytes32 tokenId) external view returns (address)',
  'function tokenManagerAddress(bytes32 tokenId) external view returns (address)',
];

// ERC20 ABI for token balance checks
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validate XRPL address format
 */
function isValidXRPLAddress(address) {
  const xrplAddressRegex = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  return xrplAddressRegex.test(address);
}

/**
 * Convert XRPL address to bytes for ITS
 */
function encodeXRPLAddress(address) {
  return '0x' + Buffer.from(address).toString('hex');
}

/**
 * Format XRP amount for display
 */
function formatXRP(wei) {
  return parseFloat(ethers.formatEther(wei)).toFixed(6);
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Test Steps
// =============================================================================

async function runBridgeTest(amount, xrplDestination) {
  console.log('\n' + '='.repeat(70));
  console.log('  XRPL EVM → XRPL Bridge Test (Testnet)');
  console.log('='.repeat(70) + '\n');

  const results = {
    success: false,
    steps: [],
    blockers: [],
    txHash: null,
  };

  // ---------------------------------------------------------------------------
  // Step 1: Validate Environment
  // ---------------------------------------------------------------------------
  console.log('📋 Step 1: Validating environment...\n');

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    results.blockers.push('CRITICAL: PRIVATE_KEY not set in .env');
    console.log('❌ PRIVATE_KEY not found in .env');
    return results;
  }
  results.steps.push({ name: 'Environment check', status: 'PASS' });
  console.log('✅ PRIVATE_KEY found');

  // Validate XRPL destination
  if (!isValidXRPLAddress(xrplDestination)) {
    results.blockers.push(`CRITICAL: Invalid XRPL address format: ${xrplDestination}`);
    console.log(`❌ Invalid XRPL address: ${xrplDestination}`);
    return results;
  }
  results.steps.push({ name: 'XRPL address validation', status: 'PASS' });
  console.log(`✅ Valid XRPL destination: ${xrplDestination}`);

  // ---------------------------------------------------------------------------
  // Step 2: Connect to XRPL EVM Testnet
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 2: Connecting to XRPL EVM Testnet...\n');

  let provider, wallet;
  try {
    provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const network = await provider.getNetwork();

    if (network.chainId !== BigInt(CONFIG.CHAIN_ID)) {
      results.blockers.push(`CRITICAL: Wrong chain ID. Expected ${CONFIG.CHAIN_ID}, got ${network.chainId}`);
      console.log(`❌ Chain ID mismatch: expected ${CONFIG.CHAIN_ID}, got ${network.chainId}`);
      return results;
    }

    wallet = new ethers.Wallet(privateKey, provider);
    results.steps.push({ name: 'RPC connection', status: 'PASS' });
    console.log(`✅ Connected to XRPL EVM Testnet (Chain ID: ${network.chainId})`);
    console.log(`   Wallet: ${wallet.address}`);
  } catch (error) {
    results.blockers.push(`CRITICAL: Failed to connect to RPC: ${error.message}`);
    console.log(`❌ RPC connection failed: ${error.message}`);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Step 3: Check Wallet Balance
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 3: Checking wallet balances...\n');

  try {
    // On XRPL EVM, XRP is the native token (like ETH on Ethereum)
    // We use native balance for both gas AND bridging
    const nativeBalance = await provider.getBalance(wallet.address);
    console.log(`   Native XRP Balance: ${formatXRP(nativeBalance)} XRP`);

    // Estimate gas cost
    const estimatedGasCost = BigInt(CONFIG.GAS_LIMIT) * ethers.parseUnits(String(CONFIG.GAS_PRICE_GWEI), 'gwei');
    const crossChainGas = ethers.parseEther('0.01'); // Gas for Axelar relayers
    const amountWei = ethers.parseEther(amount);
    const totalNeeded = amountWei + estimatedGasCost + crossChainGas;

    console.log(`   Amount to bridge: ${amount} XRP`);
    console.log(`   Cross-chain gas: 0.01 XRP`);
    console.log(`   EVM gas (est): ${formatXRP(estimatedGasCost)} XRP`);
    console.log(`   Total needed: ${formatXRP(totalNeeded)} XRP`);

    if (nativeBalance < totalNeeded) {
      results.blockers.push(`CRITICAL: Insufficient balance. Need ${formatXRP(totalNeeded)} XRP, have ${formatXRP(nativeBalance)} XRP`);
      console.log(`❌ Insufficient balance`);
      return results;
    }

    results.steps.push({ name: 'Balance check', status: 'PASS' });
    console.log(`✅ Sufficient balance (${formatXRP(nativeBalance)} XRP available)`);
  } catch (error) {
    results.blockers.push(`CRITICAL: Balance check failed: ${error.message}`);
    console.log(`❌ Balance check failed: ${error.message}`);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Step 4: Verify ITS Contract
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 4: Verifying ITS contract...\n');

  let itsContract;
  try {
    itsContract = new ethers.Contract(CONFIG.ITS_CONTRACT, ITS_ABI, wallet);

    // Verify token is registered
    const tokenAddress = await itsContract.interchainTokenAddress(CONFIG.XRP_TOKEN_ID);
    console.log(`   Token Address: ${tokenAddress}`);

    const tokenManager = await itsContract.tokenManagerAddress(CONFIG.XRP_TOKEN_ID);
    console.log(`   Token Manager: ${tokenManager}`);

    if (tokenAddress === ethers.ZeroAddress) {
      results.blockers.push('CRITICAL: XRP token not registered with ITS');
      console.log('❌ Token not registered');
      return results;
    }

    results.steps.push({ name: 'ITS contract verification', status: 'PASS' });
    console.log('✅ ITS contract verified, XRP token registered');
  } catch (error) {
    results.blockers.push(`CRITICAL: ITS verification failed: ${error.message}`);
    console.log(`❌ ITS verification failed: ${error.message}`);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Step 5: Prepare Bridge Transaction
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 5: Preparing bridge transaction...\n');

  const amountWei = ethers.parseEther(amount);
  const destinationBytes = encodeXRPLAddress(xrplDestination);

  console.log(`   Amount: ${amount} XRP (${amountWei.toString()} wei)`);
  console.log(`   Destination Chain: ${CONFIG.DESTINATION_CHAIN}`);
  console.log(`   Destination Address: ${xrplDestination}`);
  console.log(`   Destination (encoded): ${destinationBytes}`);

  // Gas value for cross-chain execution (pay for Axelar relayers)
  // This is sent as msg.value along with the transaction
  const gasValue = ethers.parseEther('0.01'); // 0.01 XRP for cross-chain gas
  console.log(`   Cross-chain gas: ${formatXRP(gasValue)} XRP`);

  results.steps.push({ name: 'Transaction preparation', status: 'PASS' });
  console.log('✅ Transaction prepared');

  // ---------------------------------------------------------------------------
  // Step 6: Estimate Gas
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 6: Estimating gas...\n');

  let gasEstimate;
  try {
    // For native token transfers via ITS, we send the amount as msg.value
    gasEstimate = await itsContract.interchainTransfer.estimateGas(
      CONFIG.XRP_TOKEN_ID,
      CONFIG.DESTINATION_CHAIN,
      destinationBytes,
      amountWei,
      '0x', // Empty metadata
      gasValue,
      { value: amountWei + gasValue } // Total value = amount + cross-chain gas
    );

    console.log(`   Estimated gas: ${gasEstimate.toString()}`);
    console.log(`   Gas limit (with buffer): ${Math.ceil(Number(gasEstimate) * 1.3)}`);

    results.steps.push({ name: 'Gas estimation', status: 'PASS' });
    console.log('✅ Gas estimated successfully');
  } catch (error) {
    // Gas estimation failure is a critical blocker
    results.blockers.push(`CRITICAL: Gas estimation failed: ${error.message}`);
    console.log(`❌ Gas estimation failed: ${error.message}`);
    console.log('\n   This usually means:');
    console.log('   - Token not properly registered with ITS');
    console.log('   - Incorrect token ID');
    console.log('   - Destination chain not supported');
    console.log('   - Contract call would revert');

    // Try to decode the error
    if (error.data) {
      console.log(`\n   Error data: ${error.data}`);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Step 7: Execute Bridge Transaction (DRY RUN)
  // ---------------------------------------------------------------------------
  console.log('\n📋 Step 7: Bridge transaction ready...\n');

  console.log('   ⚠️  DRY RUN MODE - Transaction not submitted');
  console.log('   To execute the actual bridge, uncomment the transaction code below.\n');

  const txParams = {
    to: CONFIG.ITS_CONTRACT,
    value: amountWei + gasValue,
    gasLimit: Math.ceil(Number(gasEstimate) * 1.3),
    gasPrice: ethers.parseUnits(String(CONFIG.GAS_PRICE_GWEI), 'gwei'),
  };

  console.log('   Transaction Parameters:');
  console.log(`   - To: ${txParams.to}`);
  console.log(`   - Value: ${formatXRP(txParams.value)} XRP`);
  console.log(`   - Gas Limit: ${txParams.gasLimit}`);
  console.log(`   - Gas Price: ${CONFIG.GAS_PRICE_GWEI} gwei`);
  console.log(`   - Estimated Cost: ${formatXRP(BigInt(txParams.gasLimit) * txParams.gasPrice)} XRP`);

  results.steps.push({ name: 'Dry run', status: 'PASS' });

  // ---------------------------------------------------------------------------
  // Uncomment below to execute real transaction
  // ---------------------------------------------------------------------------

  /*
  console.log('\n📋 Step 7: Executing bridge transaction...\n');

  try {
    const tx = await itsContract.interchainTransfer(
      CONFIG.XRP_TOKEN_ID,
      CONFIG.DESTINATION_CHAIN,
      destinationBytes,
      amountWei,
      '0x', // Empty metadata
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
    console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

    results.txHash = tx.hash;
    results.steps.push({ name: 'Transaction execution', status: 'PASS' });
    results.success = true;

    console.log(`\n🔗 Track on Axelarscan:`);
    console.log(`   https://testnet.axelarscan.io/gmp/${tx.hash}`);

  } catch (error) {
    results.blockers.push(`CRITICAL: Transaction failed: ${error.message}`);
    console.log(`❌ Transaction failed: ${error.message}`);
    return results;
  }
  */

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('  Test Summary');
  console.log('='.repeat(70) + '\n');

  console.log('Steps Completed:');
  results.steps.forEach((step, i) => {
    const icon = step.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${i + 1}. ${icon} ${step.name}`);
  });

  if (results.blockers.length > 0) {
    console.log('\n⛔ Blockers:');
    results.blockers.forEach((blocker, i) => {
      console.log(`  ${i + 1}. ${blocker}`);
    });
  } else {
    console.log('\n✅ All checks passed! Ready to execute real bridge transaction.');
    console.log('   Edit the script to uncomment the transaction execution code.');
    results.success = true;
  }

  return results;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const amount = args[0] || CONFIG.DEFAULT_AMOUNT;
  const xrplDestination = args[1] || 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9'; // Example testnet address

  console.log('\n🌉 XRPL EVM → XRPL Bridge Test\n');
  console.log(`Amount: ${amount} XRP`);
  console.log(`Destination: ${xrplDestination}`);

  try {
    const results = await runBridgeTest(amount, xrplDestination);

    // Exit code based on success
    process.exit(results.success ? 0 : 1);
  } catch (error) {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  }
}

main();
