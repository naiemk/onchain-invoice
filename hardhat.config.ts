import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const baseRpcUrl = process.env.BASE_RPC_URL?.trim() || process.env.EVM_8453_RPC_URL?.trim();
const bscRpcUrl = process.env.BSC_RPC_URL?.trim() || process.env.EVM_56_RPC_URL?.trim();
const evmPrivateKey = process.env.EVM_PRIVATE_KEY?.trim();
const etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim();

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
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
        version: "0.8.24",
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
      url: sepoliaRpcUrl || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
    base: {
      type: "http",
      chainType: "l1",
      url: baseRpcUrl || "https://mainnet.base.org",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      url: bscRpcUrl || "https://bsc-dataseed.binance.org",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
  },
  verify: {
    etherscan: {
      // Optional — Sourcify/Blockscout still run without it. Set ETHERSCAN_API_KEY in root .env.
      apiKey: etherscanApiKey || "",
    },
  },
});
