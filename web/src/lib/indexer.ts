import type { Address, Hex } from "viem";
import { sanitizePreferences, type Preferences } from "./preferences";

export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "").replace(/\/$/, "");

export interface ActivityEvent {
  chainId: number;
  contract: Address;
  eventName: string;
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
  timestamp: number | null;
  args: Record<string, string>;
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

export async function fetchPreferences(
  address: Address,
): Promise<{ preferences: Partial<Preferences>; updatedAt: number } | null> {
  if (!INDEXER_URL) return null;
  try {
    const response = await fetch(`${INDEXER_URL}/v1/preferences/${address.toLowerCase()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { preferences?: unknown; updatedAt?: string | null };
    if (!body.preferences || !body.updatedAt) return null;
    const updatedAt = Date.parse(body.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    return { preferences: sanitizePreferences(body.preferences), updatedAt };
  } catch {
    return null;
  }
}

export async function savePreferences(input: {
  address: Address;
  chainId: number;
  preferences: Preferences;
  issuedAt: string;
  nonce: string;
  signature: Hex;
}): Promise<boolean> {
  if (!INDEXER_URL) return false;
  const response = await fetch(`${INDEXER_URL}/v1/preferences/${input.address.toLowerCase()}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.ok;
}

export async function fetchActivity(chainId: number, address: Address): Promise<ActivityEvent[] | null> {
  if (!INDEXER_URL) return null;
  try {
    const response = await fetch(`${INDEXER_URL}/v1/chains/${chainId}/activity?address=${address.toLowerCase()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { events?: ActivityEvent[] };
    return body.events ?? null;
  } catch {
    return null;
  }
}
