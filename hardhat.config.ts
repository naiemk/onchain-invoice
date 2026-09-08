import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const sepoliaRpcUrl =
  process.env.SEPOLIA_RPC_URL?.trim() || process.env.EVM_RPC_URL?.trim();
const baseRpcUrl = process.env.BASE_RPC_URL?.trim() || process.env.EVM_8453_RPC_URL?.trim();
const bscRpcUrl = process.env.BSC_RPC_URL?.trim() || process.env.EVM_56_RPC_URL?.trim();
const evmPrivateKey =
  process.env.EVM_PRIVATE_KEY?.trim() || process.env.SWEEPER_PRIVATE_KEY?.trim();
// Etherscan API v2 key covers Ethereum / Base / BNB and other supported explorers.
const etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim();

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1_000_000,
          },
          viaIR: true,
        },
      },
      // hardhat-verify defaults to this profile — keep identical to `default`.
      production: {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1_000_000,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: sepoliaRpcUrl || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
    base: {
      type: "http",
      chainType: "l1",
      chainId: 8453,
      url: baseRpcUrl || "https://mainnet.base.org",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      chainId: 56,
      url: bscRpcUrl || "https://bsc-dataseed.binance.org",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.HARDHAT_RPC_URL?.trim() || "http://127.0.0.1:8545",
      accounts: evmPrivateKey
        ? [evmPrivateKey]
        : [
            // Hardhat node default accounts 0–2 (public test keys)
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
            "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
          ],
    },
    e2eLocal: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 11155111,
    },
  },
  verify: {
    etherscan: {
      // Optional — Sourcify/Blockscout still run without it. Set ETHERSCAN_API_KEY in root .env.
      apiKey: etherscanApiKey || "",
    },
    sourcify: {
      enabled: false,
    },
  },
});
