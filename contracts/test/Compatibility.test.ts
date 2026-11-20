import { expect } from "chai";
import { artifacts } from "hardhat";

const PRODUCTION = [
  "src/ProtocolConfig.sol:ProtocolConfig",
  "src/LockVault.sol:LockVault",
  "src/NftLockVault.sol:NftLockVault",
  "src/LockableAccount.sol:LockableAccount",
  "src/LockableAccountFactory.sol:LockableAccountFactory",
];

const FORBIDDEN: Record<number, string> = {
  0x5f: "PUSH0",
  0x5c: "TLOAD",
  0x5d: "TSTORE",
  0x5e: "MCOPY",
  0x49: "BLOBHASH",
  0x4a: "BLOBBASEFEE",
};

function forbiddenOpcodes(bytecode: string, sourceMap: string): string[] {
  const code = Buffer.from(bytecode.replace(/^0x/, ""), "hex");
  const instructions = sourceMap.split(";").length;
  const found = new Set<string>();
  let pc = 0;
  for (let n = 0; n < instructions && pc < code.length; n++) {
    const op = code[pc];
    if (FORBIDDEN[op]) found.add(FORBIDDEN[op]);
    pc += op >= 0x60 && op <= 0x7f ? op - 0x5e : 1;
  }
  return [...found];
}

describe("EVM compatibility of production contracts", () => {
  it("detects newer opcodes (sanity check on a Cancun-compiled test mock)", async () => {
    const name = "src/mocks/MockCollections.sol:MockCollectibles";
    const buildInfo = await artifacts.getBuildInfo(name);
    expect(buildInfo!.input.settings.evmVersion).to.equal("cancun");
    const evm = (buildInfo!.output.contracts["src/mocks/MockCollections.sol"].MockCollectibles as any).evm;
    expect(forbiddenOpcodes(evm.deployedBytecode.object, evm.deployedBytecode.sourceMap)).to.include("PUSH0");
  });

  for (const name of PRODUCTION) {
    it(`${name.split(":")[1]} is compiled for "paris" and uses no newer opcode`, async () => {
      const buildInfo = await artifacts.getBuildInfo(name);
      expect(buildInfo, "build info").to.not.equal(undefined);
      expect(buildInfo!.input.settings.evmVersion).to.equal("paris");

      const [file, contract] = name.split(":");
      const evm = (buildInfo!.output.contracts[file][contract] as any).evm;
      expect(forbiddenOpcodes(evm.deployedBytecode.object, evm.deployedBytecode.sourceMap)).to.deep.equal([]);
      expect(forbiddenOpcodes(evm.bytecode.object, evm.bytecode.sourceMap)).to.deep.equal([]);
    });
  }
});
