import { encodeFunctionData, parseAbi, zeroAddress, type Hex } from "viem";
import type { TrackedApproval } from "@/hooks/protocol";

const revokeAbi = parseAbi([
  "function approve(address spender, uint256 value)",
  "function setApprovalForAll(address operator, bool approved)",
  "function revokeOperator(address operator)",
  "function setOperator(address spender, bool approved)",
]);

const erc6909Abi = parseAbi(["function approve(address spender, uint256 id, uint256 amount)"]);

export const APPROVAL_KIND_LABEL: Record<number, string> = {
  0: "ERC-20",
  1: "ERC-721",
  2: "Operator",
  3: "ERC-777",
  4: "ERC-6909 operator",
  5: "ERC-6909",
};

export function revokeCalldata(approval: TrackedApproval): Hex {
  switch (approval.kind) {
    case 0:
      return encodeFunctionData({ abi: revokeAbi, functionName: "approve", args: [approval.spender, 0n] });
    case 1:
      return encodeFunctionData({ abi: revokeAbi, functionName: "approve", args: [zeroAddress, approval.id] });
    case 2:
      return encodeFunctionData({ abi: revokeAbi, functionName: "setApprovalForAll", args: [approval.spender, false] });
    case 3:
      return encodeFunctionData({ abi: revokeAbi, functionName: "revokeOperator", args: [approval.spender] });
    case 4:
      return encodeFunctionData({ abi: revokeAbi, functionName: "setOperator", args: [approval.spender, false] });
    default:
      return encodeFunctionData({ abi: erc6909Abi, functionName: "approve", args: [approval.spender, approval.id, 0n] });
  }
}
