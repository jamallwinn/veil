require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Default private key for testing - DO NOT USE IN PRODUCTION
const DEFAULT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false, // Disabled for faster compilation
      evmVersion: "berlin", // XRPL EVM compatibility (most conservative)
    },
  },
  networks: {
    // Local development
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // XRPL EVM Sidechain Devnet (Chain ID: 1440002)
    xrplEvmDevnet: {
      url: "https://rpc-evm-sidechain.xrpl.org",
      chainId: 1440002,
      accounts: [process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY],
      gasPrice: 10000000000, // 10 gwei
    },

    // XRPL EVM Sidechain Testnet (Chain ID: 1449000) - PRIMARY TARGET
    xrplEvmTestnet: {
      url: "https://rpc.testnet.xrplevm.org",
      chainId: 1449000,
      accounts: [process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY],
      gasPrice: 300000000000, // 300 gwei (network requires ~275 gwei minimum)
    },

    // XRPL EVM Sidechain Mainnet (Chain ID: 1440000)
    xrplEvmMainnet: {
      url: process.env.XRPL_EVM_MAINNET_RPC || "https://rpc.xrplevm.org",
      chainId: 1440000,
      accounts: [process.env.PRIVATE_KEY || DEFAULT_PRIVATE_KEY],
      gasPrice: 275000000000, // 275 gwei (network minimum)
    },
  },

  etherscan: {
    apiKey: {
      // XRPL EVM Explorer API key (if available)
      xrplEvmMainnet: process.env.EXPLORER_API_KEY || "not-needed",
      xrplEvmTestnet: process.env.EXPLORER_API_KEY || "not-needed",
      xrplEvmDevnet: process.env.EXPLORER_API_KEY || "not-needed",
    },
    customChains: [
      {
        network: "xrplEvmMainnet",
        chainId: 1440000,
        urls: {
          apiURL: "https://explorer.xrplevm.org/api",
          browserURL: "https://explorer.xrplevm.org",
        },
      },
      {
        network: "xrplEvmTestnet",
        chainId: 1449000,
        urls: {
          apiURL: "https://explorer.testnet.xrplevm.org/api",
          browserURL: "https://explorer.testnet.xrplevm.org",
        },
      },
      {
        network: "xrplEvmDevnet",
        chainId: 1440002,
        urls: {
          apiURL: "https://evm-sidechain.xrpl.org/api",
          browserURL: "https://evm-sidechain.xrpl.org",
        },
      },
    ],
  },

  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  // Gas reporter configuration
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },

  // TypeScript type generation
  typechain: {
    outDir: "src/types/contracts",
    target: "ethers-v6",
  },
};
