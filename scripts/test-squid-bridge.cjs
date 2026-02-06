#!/usr/bin/env node
/**
 * Squid Router Bridge Test Script
 *
 * IMPORTANT LIMITATION (as of 2026-01-30):
 * The Squid v2 public API does NOT support XRPL EVM (chain 1440000) or XRPL mainnet.
 * This script will FAIL for XRPL bridging with "unsupported chain id" error.
 *
 * For XRPL EVM <-> XRPL bridging, use:
 *   node scripts/test-bridge-mainnet.cjs --execute
 * which uses Axelar ITS directly (verified working on mainnet).
 *
 * This script demonstrates the Squid Router API integration pattern and can be
 * adapted for EVM-to-EVM cross-chain swaps on supported chains (Ethereum,
 * Arbitrum, Polygon, etc. - 91 chains total, NOT including XRPL).
 *
 * Usage:
 *   node scripts/test-squid-bridge.cjs                    # Dry run with 0.5 XRP (WILL FAIL)
 *   node scripts/test-squid-bridge.cjs --execute          # Execute (WILL FAIL)
 *
 * Environment:
 *   PRIVATE_KEY - EVM wallet private key
 *   SQUID_INTEGRATOR_ID - (optional) Your Squid integrator ID
 *
 * @see https://docs.squidrouter.com/api-and-sdk-integration/key-concepts/get-supported-tokens-and-chains
 */

const { ethers } = require('ethers');
require('dotenv').config();

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // XRPL EVM Mainnet (source chain)
  XRPL_EVM: {
    CHAIN_ID: '1440000',
    RPC_URL: 'https://rpc.xrplevm.org',
    NAME: 'XRPL EVM Mainnet',
  },

  // XRPL (destination chain)
  XRPL: {
    CHAIN_ID: 'xrpl',
    NAME: 'XRP Ledger',
  },

  // Squid API
  SQUID_API: {
    BASE_URL: 'https://v2.api.squidrouter.com',
    ROUTE_ENDPOINT: '/v2/route',
    STATUS_ENDPOINT: '/v2/status',
  },

  // Native token address (same for all chains in Squid)
  NATIVE_TOKEN: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',

  // Squid contracts on XRPL EVM
  SQUID_ROUTER_PROXY: '0xce16F69375520ab01377ce7B88f5BA8C48F8D666',

  // Test configuration
  DEFAULT_AMOUNT: '0.5', // XRP
  DEFAULT_XRPL_DESTINATION: 'rLrTFtLYnQcgzDH8sfMHBWsAbCuqBuLrs6',

  // Use the widget integrator ID for testing (public)
  DEFAULT_INTEGRATOR_ID: 'squid-swap-widget',
};

// =============================================================================
// Utility Functions
// =============================================================================

function isValidXRPLAddress(address) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

function isValidEVMAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function formatXRP(wei) {
  return parseFloat(ethers.formatEther(wei)).toFixed(6);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Squid Router API Functions
// =============================================================================

/**
 * Get a bridge route from Squid API
 */
async function getSquidRoute(params, integratorId) {
  const url = `${CONFIG.SQUID_API.BASE_URL}${CONFIG.SQUID_API.ROUTE_ENDPOINT}`;

  console.log('\n   Requesting route from Squid API...');
  console.log(`   URL: ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-integrator-id': integratorId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const requestId = response.headers.get('x-request-id');

  if (!response.ok) {
    const errorText = await response.text();
    console.log(`   Error response: ${errorText}`);
    throw new Error(`Squid API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  data.requestId = requestId;

  return data;
}

/**
 * Get bridge status from Squid API
 */
async function getSquidStatus(params, integratorId) {
  const queryString = new URLSearchParams({
    transactionId: params.transactionId,
    requestId: params.requestId,
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
  }).toString();

  const url = `${CONFIG.SQUID_API.BASE_URL}${CONFIG.SQUID_API.STATUS_ENDPOINT}?${queryString}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-integrator-id': integratorId,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Squid status error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Poll for transaction completion
 */
async function waitForBridgeCompletion(params, integratorId, maxAttempts = 60) {
  console.log('\n   Polling for transaction status...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await getSquidStatus(params, integratorId);

      console.log(`   Attempt ${i + 1}/${maxAttempts}: ${status.squidTransactionStatus || status.status}`);

      if (status.squidTransactionStatus === 'SUCCESS') {
        return { success: true, status };
      }

      if (status.squidTransactionStatus === 'NEEDS_GAS' ||
          status.squidTransactionStatus === 'PARTIAL_SUCCESS') {
        return { success: false, status, needsAttention: true };
      }

      // Continue polling for NOT_FOUND or ONGOING
      await sleep(5000);
    } catch (error) {
      console.log(`   Status check error: ${error.message}`);
      await sleep(5000);
    }
  }

  return { success: false, timeout: true };
}

// =============================================================================
// Bridge Test
// =============================================================================

async function runBridgeTest(amount, xrplDestination, execute = false) {
  console.log('\n' + '='.repeat(70));
  console.log('  Squid Router Bridge Test: XRPL EVM -> XRPL');
  console.log('='.repeat(70) + '\n');

  const integratorId = process.env.SQUID_INTEGRATOR_ID || CONFIG.DEFAULT_INTEGRATOR_ID;

  // Step 1: Validate inputs
  console.log('[Step 1] Validating inputs...\n');

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('   PRIVATE_KEY not found in .env');
    return { success: false, error: 'Missing PRIVATE_KEY' };
  }
  console.log('   PRIVATE_KEY found');

  if (!isValidXRPLAddress(xrplDestination)) {
    console.log(`   Invalid XRPL address: ${xrplDestination}`);
    return { success: false, error: 'Invalid XRPL address' };
  }
  console.log(`   Valid XRPL destination: ${xrplDestination}`);
  console.log(`   Integrator ID: ${integratorId}`);

  // Step 2: Connect to XRPL EVM
  console.log('\n[Step 2] Connecting to XRPL EVM Mainnet...\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.XRPL_EVM.RPC_URL);

  try {
    const network = await provider.getNetwork();
    console.log(`   Chain ID: ${network.chainId}`);

    if (network.chainId !== BigInt(CONFIG.XRPL_EVM.CHAIN_ID)) {
      console.log(`   Warning: Expected chain ID ${CONFIG.XRPL_EVM.CHAIN_ID}, got ${network.chainId}`);
    }
  } catch (error) {
    console.log(`   Failed to connect: ${error.message}`);
    return { success: false, error: 'RPC connection failed' };
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`   Wallet address: ${wallet.address}`);

  // Step 3: Check balance
  console.log('\n[Step 3] Checking balance...\n');

  const balance = await provider.getBalance(wallet.address);
  console.log(`   Balance: ${formatXRP(balance)} XRP`);

  const amountWei = ethers.parseEther(amount);
  console.log(`   Amount to bridge: ${amount} XRP (${amountWei.toString()} wei)`);

  if (balance < amountWei) {
    console.log(`\n   Insufficient balance!`);
    console.log(`   Need: ${amount} XRP`);
    console.log(`   Have: ${formatXRP(balance)} XRP`);
    console.log(`\n   To fund your wallet, bridge XRP from XRPL mainnet via:`);
    console.log(`   https://bridge.xrplevm.org/`);
    return { success: false, error: 'Insufficient balance' };
  }
  console.log('   Balance sufficient');

  // Step 4: Get route from Squid
  console.log('\n[Step 4] Getting route from Squid API...\n');

  const routeParams = {
    fromChain: CONFIG.XRPL_EVM.CHAIN_ID,
    toChain: CONFIG.XRPL.CHAIN_ID,
    fromToken: CONFIG.NATIVE_TOKEN,
    toToken: CONFIG.NATIVE_TOKEN,
    fromAmount: amountWei.toString(),
    fromAddress: wallet.address,
    toAddress: xrplDestination,
    slippage: 1,
    slippageConfig: { autoMode: 1 },
    quoteOnly: !execute, // Get full tx data only when executing
  };

  console.log('   Route params:');
  console.log(`     fromChain: ${routeParams.fromChain} (${CONFIG.XRPL_EVM.NAME})`);
  console.log(`     toChain: ${routeParams.toChain} (${CONFIG.XRPL.NAME})`);
  console.log(`     fromToken: ${routeParams.fromToken} (native XRP)`);
  console.log(`     toToken: ${routeParams.toToken} (native XRP)`);
  console.log(`     fromAmount: ${routeParams.fromAmount}`);
  console.log(`     fromAddress: ${routeParams.fromAddress}`);
  console.log(`     toAddress: ${routeParams.toAddress}`);
  console.log(`     quoteOnly: ${routeParams.quoteOnly}`);

  let route;
  try {
    route = await getSquidRoute(routeParams, integratorId);
    console.log('\n   Route received!');
    console.log(`   Request ID: ${route.requestId}`);

    if (route.route && route.route.estimate) {
      const estimate = route.route.estimate;
      console.log('\n   Estimate:');
      console.log(`     From: ${formatXRP(estimate.fromAmount)} XRP ($${estimate.fromAmountUSD || 'N/A'})`);
      console.log(`     To: ${formatXRP(estimate.toAmount)} XRP ($${estimate.toAmountUSD || 'N/A'})`);
      console.log(`     Min output: ${formatXRP(estimate.toAmountMin)} XRP`);
      console.log(`     Duration: ${estimate.estimatedRouteDuration || 'N/A'} seconds`);
      console.log(`     Exchange rate: ${estimate.exchangeRate || 'N/A'}`);

      if (estimate.feeCosts && estimate.feeCosts.length > 0) {
        console.log('     Fees:');
        estimate.feeCosts.forEach((fee) => {
          console.log(`       - ${fee.name}: ${fee.amount} ${fee.token?.symbol || ''} ($${fee.amountUSD || '0'})`);
        });
      }

      if (estimate.gasCosts && estimate.gasCosts.length > 0) {
        console.log('     Gas costs:');
        estimate.gasCosts.forEach((gas) => {
          console.log(`       - ${formatXRP(gas.amount)} ${gas.token?.symbol || ''} ($${gas.amountUSD || '0'})`);
        });
      }
    }
  } catch (error) {
    console.log(`\n   Failed to get route: ${error.message}`);
    return { success: false, error: error.message };
  }

  // Step 5: Execute or dry run
  if (!execute) {
    console.log('\n[Step 5] Dry run complete\n');
    console.log('   Route validated successfully!');
    console.log('   To execute the bridge, run with --execute flag');
    return { success: true, dryRun: true, route };
  }

  console.log('\n[Step 5] Executing bridge transaction...\n');

  if (!route.route || !route.route.transactionRequest) {
    console.log('   No transaction data in route response');
    console.log('   This may happen if the route is invalid or quoteOnly was set');
    return { success: false, error: 'No transaction data' };
  }

  const txRequest = route.route.transactionRequest;
  console.log('   Transaction details:');
  console.log(`     Target: ${txRequest.target}`);
  console.log(`     Value: ${formatXRP(txRequest.value)} XRP`);
  console.log(`     Gas limit: ${txRequest.gasLimit}`);
  console.log(`     Data: ${txRequest.data.substring(0, 66)}...`);

  try {
    console.log('\n   Sending transaction...');

    const tx = await wallet.sendTransaction({
      to: txRequest.target,
      data: txRequest.data,
      value: BigInt(txRequest.value),
      gasLimit: BigInt(txRequest.gasLimit),
      gasPrice: txRequest.gasPrice ? BigInt(txRequest.gasPrice) : undefined,
    });

    console.log(`   Transaction submitted: ${tx.hash}`);
    console.log('   Waiting for confirmation...');

    const receipt = await tx.wait();

    if (receipt.status !== 1) {
      console.log('   Transaction reverted!');
      return { success: false, txHash: tx.hash, error: 'Transaction reverted' };
    }

    console.log(`\n   Transaction confirmed!`);
    console.log(`     Block: ${receipt.blockNumber}`);
    console.log(`     Gas used: ${receipt.gasUsed.toString()}`);

    // Step 6: Track bridge status
    console.log('\n[Step 6] Tracking cross-chain status...\n');

    const statusParams = {
      transactionId: tx.hash,
      requestId: route.requestId,
      fromChainId: CONFIG.XRPL_EVM.CHAIN_ID,
      toChainId: CONFIG.XRPL.CHAIN_ID,
    };

    const bridgeResult = await waitForBridgeCompletion(statusParams, integratorId);

    if (bridgeResult.success) {
      console.log('\n   Bridge completed successfully!');
      if (bridgeResult.status?.toChain) {
        console.log(`   Destination TX: ${bridgeResult.status.toChain.transactionId}`);
        console.log(`   Block: ${bridgeResult.status.toChain.blockNumber}`);
      }
      return {
        success: true,
        txHash: tx.hash,
        requestId: route.requestId,
        status: bridgeResult.status,
      };
    } else if (bridgeResult.timeout) {
      console.log('\n   Status polling timed out');
      console.log('   Bridge may still complete. Check manually:');
      console.log(`   https://axelarscan.io/gmp/${tx.hash}`);
      return {
        success: true,
        txHash: tx.hash,
        requestId: route.requestId,
        pending: true,
      };
    } else {
      console.log('\n   Bridge may need attention');
      console.log(`   Status: ${bridgeResult.status?.squidTransactionStatus}`);
      return {
        success: false,
        txHash: tx.hash,
        error: bridgeResult.status?.squidTransactionStatus || 'Unknown error',
      };
    }
  } catch (error) {
    console.log(`\n   Transaction failed: ${error.message}`);

    // Parse common errors
    if (error.message.includes('insufficient funds')) {
      console.log('   Not enough XRP for amount + gas');
    }
    if (error.message.includes('execution reverted')) {
      console.log('   Contract execution reverted');
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
  const filteredArgs = args.filter((a) => a !== '--execute');

  const amount = filteredArgs[0] || CONFIG.DEFAULT_AMOUNT;
  const xrplDestination = filteredArgs[1] || CONFIG.DEFAULT_XRPL_DESTINATION;

  console.log('\n Squid Router Bridge Test\n');
  console.log(`Amount: ${amount} XRP`);
  console.log(`Destination: ${xrplDestination}`);
  console.log(`Mode: ${execute ? ' EXECUTE' : ' DRY RUN'}`);

  const result = await runBridgeTest(amount, xrplDestination, execute);

  console.log('\n' + '='.repeat(70));
  console.log('  Result:', result.success ? ' SUCCESS' : ' FAILED');
  if (result.dryRun) console.log('  Mode: Dry run (no transaction sent)');
  if (result.txHash) console.log('  TX Hash:', result.txHash);
  if (result.requestId) console.log('  Request ID:', result.requestId);
  if (result.pending) console.log('  Status: Pending (check Axelarscan)');
  if (result.error) console.log('  Error:', result.error);
  console.log('='.repeat(70) + '\n');

  if (result.txHash) {
    console.log(' Track on Axelarscan:');
    console.log(`https://axelarscan.io/gmp/${result.txHash}\n`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
