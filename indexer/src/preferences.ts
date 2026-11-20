import { type Address, type Hex, isAddress, isHex, verifyMessage } from "viem";

export interface Preferences {
  language: "en" | "fr";
  notifyMaturity: boolean;
  notifyTransactions: boolean;
  reminderDays: 0 | 1 | 3 | 7;
}

export function parsePreferences(input: unknown): Preferences | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (raw.language !== "en" && raw.language !== "fr") return null;
  if (typeof raw.notifyMaturity !== "boolean" || typeof raw.notifyTransactions !== "boolean") return null;
  if (raw.reminderDays !== 0 && raw.reminderDays !== 1 && raw.reminderDays !== 3 && raw.reminderDays !== 7) return null;
  return {
    language: raw.language,
    notifyMaturity: raw.notifyMaturity,
    notifyTransactions: raw.notifyTransactions,
    reminderDays: raw.reminderDays,
  };
}

export function preferencesMessage(address: Address, prefs: Preferences, issuedAt: string, nonce: string): string {
  const canonical = JSON.stringify({
    language: prefs.language,
    notifyMaturity: prefs.notifyMaturity,
    notifyTransactions: prefs.notifyTransactions,
    reminderDays: prefs.reminderDays,
  });
  return [
    "Save preferences",
    `Address: ${address.toLowerCase()}`,
    `Preferences: ${canonical}`,
    `Issued At: ${issuedAt}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export interface SaveRequest {
  address: Address;
  preferences: Preferences;
  issuedAt: string;
  nonce: string;
  signature: Hex;
  chainId: number | null;
}

export type ValidationResult = { ok: true; request: SaveRequest } | { ok: false; error: string };

export function validateSaveRequest(pathAddress: string, body: unknown, now: number, maxAgeMs: number): ValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid body" };
  const raw = body as Record<string, unknown>;
  if (!isAddress(pathAddress) || typeof raw.address !== "string" || raw.address.toLowerCase() !== pathAddress.toLowerCase()) {
    return { ok: false, error: "address mismatch" };
  }
  const preferences = parsePreferences(raw.preferences);
  if (!preferences) return { ok: false, error: "invalid preferences" };
  if (typeof raw.nonce !== "string" || !/^[0-9a-f]{32}$/.test(raw.nonce)) return { ok: false, error: "invalid nonce" };
  if (typeof raw.issuedAt !== "string") return { ok: false, error: "invalid issuedAt" };
  const issued = Date.parse(raw.issuedAt);
  if (!Number.isFinite(issued) || issued > now + 60_000 || now - issued > maxAgeMs) {
    return { ok: false, error: "signature expired" };
  }
  if (typeof raw.signature !== "string" || !isHex(raw.signature)) return { ok: false, error: "invalid signature" };
  return {
    ok: true,
    request: {
      address: pathAddress as Address,
      preferences,
      issuedAt: raw.issuedAt,
      nonce: raw.nonce,
      signature: raw.signature,
      chainId: typeof raw.chainId === "number" ? raw.chainId : null,
    },
  };
}

export async function verifyEoaSignature(request: SaveRequest): Promise<boolean> {
  try {
    return await verifyMessage({
      address: request.address,
      message: preferencesMessage(request.address, request.preferences, request.issuedAt, request.nonce),
      signature: request.signature,
    });
  } catch {
    return false;
  }
}
