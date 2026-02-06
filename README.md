# Veil

**Private payments on XRPL. Zero-knowledge. Zero trace.**

Veil is a privacy-first payment application built natively on XRPL's EVM Sidechain that enables private XRP and USDC transactions using zero-knowledge cryptography. It deploys custom Circom circuits, Groth16 proofs, and Solidity smart contracts to mathematically break the on-chain link between sender and recipient -- no blockchain observer can connect the two parties.

## Why Veil Exists

XRPL is one of the fastest and most efficient payment networks in the world, but every transaction is fully transparent. That's a problem. Major institutions like SBI Holdings and banks exploring blockchain settlement need transaction privacy before they can move sensitive business payments, payroll, and cross-border remittances onto a public ledger without exposing confidential financial data to competitors and bad actors.

Veil solves this by bringing the same battle-tested cryptographic approach used by Zcash and other privacy protocols to the XRP ecosystem for the first time, transforming XRPL from a transparent payment rail into a complete financial infrastructure platform where confidentiality, speed, and compliance can coexist.

## How It Works

```
Sender deposits XRP/USDC into the Privacy Pool
    -> Commitment stored in on-chain Merkle tree
    -> Recipient generates a ZK proof of ownership
    -> Withdrawal sent to a fresh address
    -> No link between deposit and withdrawal
```

The core cryptographic primitive:

```
commitment = Poseidon(nullifier, secret)
nullifierHash = Poseidon(nullifier)
```

**Deposit** stores the commitment in a Merkle tree on-chain. **Withdrawal** proves ownership of a valid commitment via a zero-knowledge proof without revealing which one -- breaking the link entirely.

## Production Status

- **3 smart contracts** deployed and live on XRPL EVM Mainnet (Chain ID: 1440000)
- **End-to-end transaction flow** verified with real XRP on-chain
- **Web deployment** running on Google Cloud Run
- **XRP and USDC** privacy pools supported
- **560+ passing tests** across unit, integration, and end-to-end suites

## Deployed Contracts (XRPL EVM Mainnet)

| Contract | Address |
|----------|---------|
| Groth16 Verifier | `0x8EAd4fb6e3fEA46c22a39f2da02E65E916D2Cd13` |
| Privacy Pool (XRP) | `0xf765F2A56EF0f6d09438E2113a2FC9932b9645bB` |
| Privacy Pool (USDC) | `0xFCafF9d4Ae430b3c4585b711868E807957804D69` |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop App | Tauri 2.0 + React 18 + TypeScript |
| Styling | Tailwind CSS |
| State Management | Zustand |
| ZK Circuits | Circom 2.1 (Groth16) |
| Proof Generation | SnarkJS (client-side) |
| Hash Function | Poseidon (~300 constraints) |
| Smart Contracts | Solidity 0.8.20 |
| Contract Tooling | Hardhat |
| Target Chain | XRPL EVM Sidechain |
| Wallet | GemWallet |
| Testing | Vitest + React Testing Library + Playwright |

## Project Structure

```
veil/
├── circuits/            # Circom ZK circuits (withdraw, merkle tree)
├── contracts/           # Solidity smart contracts (privacy pools, verifier)
├── deployments/         # On-chain deployment records
├── scripts/             # Deploy and utility scripts
├── src/
│   ├── components/      # React UI components
│   ├── pages/           # Application views
│   ├── services/        # Core services
│   │   ├── zkPool/      # ZK proof generation and pool interaction
│   │   ├── orchestrator/# Transaction orchestration
│   │   ├── bridge/      # Axelar bridge integration
│   │   ├── evm/         # EVM sidechain interaction
│   │   └── gemwallet/   # Wallet connectivity
│   ├── stores/          # Zustand state stores
│   └── utils/           # Shared utilities
├── src-tauri/           # Tauri backend (Rust)
└── tests/               # E2E test suites
```

## Getting Started

### Prerequisites

- Node.js >= 18
- [GemWallet](https://gemwallet.app/) browser extension
- Rust toolchain (for Tauri desktop builds)

### Install and Run

```bash
npm install
npm run dev            # Web dev server on http://localhost:1420
npm run tauri:dev      # Full desktop app
```

### Run Tests

```bash
npm test               # Unit + integration tests
npm run test:e2e       # End-to-end tests
npm run hardhat:test   # Smart contract tests
```

### Build

```bash
npm run build          # Web bundle
npm run tauri:build    # Desktop application
```

### Smart Contracts

```bash
npm run hardhat:compile              # Compile contracts
npm run hardhat:deploy:testnet       # Deploy to XRPL EVM Testnet
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React UI   │────>│ Orchestrator │────>│  XRPL EVM Chain │
│  (Tauri)    │     │              │     │                 │
└─────────────┘     │  ZK Prover   │     │  Privacy Pool   │
                    │  (SnarkJS)   │     │  (Solidity)     │
                    │              │     │                 │
                    │  Wallet      │     │  Groth16        │
                    │  (GemWallet) │     │  Verifier       │
                    └──────────────┘     └─────────────────┘
```

1. User initiates a private payment through the UI
2. Orchestrator coordinates the deposit into the Privacy Pool
3. A commitment is added to the on-chain Merkle tree
4. Recipient generates a ZK proof client-side via SnarkJS
5. Proof is verified on-chain by the Groth16 Verifier
6. Withdrawal is sent to a fresh address with no on-chain link to the deposit

## License

All rights reserved.
