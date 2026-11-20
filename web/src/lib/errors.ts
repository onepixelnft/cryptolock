import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { protocolErrorsAbi } from "@/generated/abis";
import type { TKey } from "@/i18n/en";

export class TransactionRevertedError extends Error {
  constructor() {
    super("Transaction reverted on-chain");
    this.name = "TransactionRevertedError";
  }
}

const KNOWN_ERRORS: Partial<Record<string, TKey>> = {
  LockDurationOutOfRange: "error.LockDurationOutOfRange",
  LockNotMatured: "error.LockNotMatured",
  LockMatured: "error.LockMatured",
  LockNotActive: "error.LockNotActive",
  NotLockOwner: "error.NotLockOwner",
  SlippageExceeded: "error.SlippageExceeded",
  StakingUnavailable: "error.StakingUnavailable",
  StakingVaultChanged: "error.StakingVaultChanged",
  FeeAssetListChanged: "error.FeeAssetListChanged",
  NotStaked: "error.NotStaked",
  NativeTokenAlias: "error.NativeTokenAlias",
  ERC4626ExceededMaxRedeem: "error.VaultCannotRedeem",
  ERC4626ExceededMaxWithdraw: "error.VaultCannotRedeem",
  EnforcedPause: "error.EnforcedPause",
  WalletIsLocked: "error.WalletIsLocked",
  WalletNotLocked: "error.WalletNotLocked",
  ApprovalStillActive: "error.ApprovalStillActive",
  InvalidStake: "error.InvalidStake",
  NotOwner: "error.NotOwner",
  ERC20InsufficientBalance: "error.ERC20InsufficientBalance",
  ERC20InsufficientAllowance: "error.ERC20InsufficientAllowance",
  ZeroAmount: "error.ZeroAmount",
  InvalidNativeValue: "error.InvalidNativeValue",
  InvalidRecoveryDelay: "error.InvalidRecoveryDelay",
  FeeTermsChanged: "error.FeeTermsChanged",
  InsufficientFee: "error.InsufficientFee",
  InvalidAmount: "error.InvalidAmount",
  TransferNotReceived: "error.TransferNotReceived",
  ERC721InsufficientApproval: "error.ERC721InsufficientApproval",
  ERC721IncorrectOwner: "error.ERC721IncorrectOwner",
  ERC1155MissingApprovalForAll: "error.ERC1155MissingApprovalForAll",
  ERC1155InsufficientBalance: "error.ERC1155InsufficientBalance",
};

export interface ErrorMessage {
  key: TKey;
  vars?: Record<string, string>;
}

function revertName(error: ContractFunctionRevertedError): string | undefined {
  if (error.data?.errorName) return error.data.errorName;
  if (error.raw) {
    try {
      return decodeErrorResult({ abi: protocolErrorsAbi, data: error.raw as Hex }).errorName;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type Walkable = { name?: string; code?: number; status?: number; message?: string; details?: string };

function environmentError(error: BaseError): ErrorMessage | null {
  const match = (test: (e: Walkable) => boolean) => !!error.walk((e) => test(e as Walkable));
  const text = `${error.shortMessage} ${error.details ?? ""} ${error.message}`;

  if (match((e) => e.code === 4001 || e.name === "UserRejectedRequestError")) return { key: "error.rejected" };
  if (match((e) => e.name === "ChainMismatchError" || e.name === "ChainNotConfiguredError")) {
    return { key: "error.chainMismatch" };
  }
  if (match((e) => e.name === "InsufficientFundsError") || /insufficient funds/i.test(text)) {
    return { key: "error.insufficientFunds" };
  }
  if (match((e) => e.name === "NonceTooLowError" || e.name === "NonceTooHighError") || /nonce too (high|low)/i.test(text)) {
    return { key: "error.nonce" };
  }
  if (match((e) => e.code === 4100 || e.name === "UnauthorizedProviderError")) return { key: "error.unauthorized" };
  if (match((e) => e.code === -32005 || e.status === 429 || e.name === "LimitExceededRpcError")) {
    return { key: "error.rateLimited" };
  }
  if (match((e) => e.name === "HttpRequestError" || e.name === "TimeoutError" || e.name === "WebSocketRequestError")) {
    return { key: "error.network" };
  }
  return null;
}

export function describeError(error: unknown): ErrorMessage {
  if (error instanceof TransactionRevertedError) return { key: "error.reverted" };
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revertName(revert);
      if (name && KNOWN_ERRORS[name]) return { key: KNOWN_ERRORS[name]! };
      if (name) return { key: "error.contract", vars: { name } };
      return { key: "error.reverted" };
    }
    return environmentError(error) ?? { key: "error.generic", vars: { detail: error.shortMessage } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied/i.test(message)) return { key: "error.rejected" };
  if (/nonce too (high|low)/i.test(message)) return { key: "error.nonce" };
  return { key: "error.generic", vars: { detail: message.slice(0, 160) } };
}
