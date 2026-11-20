import fs from "node:fs";
import path from "node:path";
import { artifacts } from "hardhat";

const EXPORTS: Array<[exportName: string, artifact: string]> = [
  ["protocolConfigAbi", "ProtocolConfig"],
  ["lockVaultAbi", "LockVault"],
  ["lockableAccountAbi", "LockableAccount"],
  ["lockableAccountFactoryAbi", "LockableAccountFactory"],
  ["nftLockVaultAbi", "NftLockVault"],
  ["erc4626Abi", "@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626"],
];

const ERROR_SOURCES = [
  "ProtocolConfig",
  "LockVault",
  "LockableAccount",
  "LockableAccountFactory",
  "NftLockVault",
  "MockERC20",
  "MockERC721",
  "MockEditions",
  "MockYieldVault",
];

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const TARGETS = [
  path.join(PROJECT_ROOT, "web", "src", "generated", "abis.ts"),
  path.join(PROJECT_ROOT, "indexer", "src", "generated", "abis.ts"),
];

const chainlinkAggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
];

async function main() {
  let out = "";
  for (const [exportName, artifactName] of EXPORTS) {
    const artifact = await artifacts.readArtifact(artifactName);
    out += `export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n\n`;
  }
  out += `export const chainlinkAggregatorAbi = ${JSON.stringify(chainlinkAggregatorAbi, null, 2)} as const;\n\n`;

  const seen = new Set<string>();
  const errors: unknown[] = [];
  for (const name of ERROR_SOURCES) {
    const artifact = await artifacts.readArtifact(name);
    for (const item of artifact.abi as Array<{ type: string; name: string; inputs: Array<{ type: string }> }>) {
      if (item.type !== "error") continue;
      const signature = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      errors.push(item);
    }
  }
  
  out += `export const protocolErrorsAbi = ${JSON.stringify(errors, null, 2)} as const;\n`;

  for (const target of TARGETS) {
    if (!fs.existsSync(path.resolve(target, "..", "..", ".."))) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
    console.log(`wrote ${path.relative(PROJECT_ROOT, target)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
