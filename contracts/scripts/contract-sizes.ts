import { artifacts } from "hardhat";

const LIMIT = 24_576;

async function main() {
  for (const name of ["ProtocolConfig", "LockVault", "NftLockVault", "LockableAccount", "LockableAccountFactory"]) {
    const artifact = await artifacts.readArtifact(name);
    const size = (artifact.deployedBytecode.length - 2) / 2;
    console.log(`${name.padEnd(24)} ${String(size).padStart(6)} bytes  (${((size / LIMIT) * 100).toFixed(1)}% of limit)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
