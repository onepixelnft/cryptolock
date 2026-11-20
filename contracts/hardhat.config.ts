import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { LIVE_NETWORKS, findNetwork } from "./scripts/networks";

dotenv.config();

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const accounts = deployerKey ? [deployerKey] : [];

const liveNetworks: NonNullable<HardhatUserConfig["networks"]> = {};
for (const net of Object.values(LIVE_NETWORKS)) {
  const url = process.env[`RPC_URL_${net.chain.id}`]?.trim() || net.rpcUrl || net.chain.rpcUrls.default.http[0];
  liveNetworks[net.key] = { url, accounts, chainId: net.chain.id };
}

const forkTarget = process.env.FORK_NETWORK?.trim();
const forked = forkTarget ? findNetwork(forkTarget) : undefined;
if (forkTarget && !forked) throw new Error(`FORK_NETWORK: unknown network "${forkTarget}" (only "polygon" is supported)`);
const forkUrl =
  process.env.FORK_URL?.trim() ||
  (forked ? process.env[`RPC_URL_${forked.chain.id}`]?.trim() || forked.chain.rpcUrls.default.http[0] : "");
const localNetwork: NonNullable<HardhatUserConfig["networks"]>["hardhat"] = forked
  ? { chainId: forked.chain.id, forking: { url: forkUrl } }
  : { chainId: 31337 };

const optimizer = { enabled: true, runs: 200 };

const CANCUN_ONLY_MOCKS = [
  "src/mocks/MockERC721.sol",
  "src/mocks/MockCollections.sol",
  "src/mocks/MockYieldVault.sol",
  "@openzeppelin/contracts/utils/Bytes.sol",
  "@openzeppelin/contracts/utils/Strings.sol",
  "@openzeppelin/contracts/utils/Arrays.sol",
  "@openzeppelin/contracts/utils/Memory.sol",
  "@openzeppelin/contracts/token/ERC721/ERC721.sol",
  "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol",
  "@openzeppelin/contracts/token/ERC1155/ERC1155.sol",
  "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol",
];

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: { optimizer, evmVersion: "paris" },
      },
    ],
    overrides: Object.fromEntries(
      CANCUN_ONLY_MOCKS.map((file) => [file, { version: "0.8.28", settings: { optimizer, evmVersion: "cancun" } }]),
    ),
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: localNetwork,
    localhost: { url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545", chainId: forked?.chain.id ?? 31337 },
    ...liveNetworks,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
