import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const evmPrivateKey = process.env.EVM_PRIVATE_KEY?.trim();

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha],
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
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      url: sepoliaRpcUrl || "https://rpc.sepolia.org",
      accounts: evmPrivateKey ? [evmPrivateKey] : [],
    },
  },
});
