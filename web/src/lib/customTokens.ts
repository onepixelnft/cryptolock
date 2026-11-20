"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";

export interface CustomToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

type Store = Record<string, CustomToken[]>;

const STORAGE_KEY = "lock.customTokens.v1";
const EMPTY_STORE: Store = {};
const EMPTY_LIST: CustomToken[] = [];
const listeners = new Set<() => void>();
let cache: Store | null = null;

function isCustomToken(value: unknown): value is CustomToken {
  const t = value as CustomToken;
  return (
    !!t &&
    typeof t.address === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(t.address) &&
    typeof t.symbol === "string" &&
    typeof t.name === "string" &&
    Number.isInteger(t.decimals) &&
    t.decimals >= 0 &&
    t.decimals <= 36
  );
}

function read(): Store {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    cache = Object.fromEntries(
      Object.entries(parsed).map(([chainId, list]) => [chainId, Array.isArray(list) ? list.filter(isCustomToken) : []]),
    );
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Store) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCustomTokens(chainId: number | undefined) {
  const store = useSyncExternalStore(subscribe, read, () => EMPTY_STORE);
  const tokens = chainId === undefined ? EMPTY_LIST : (store[String(chainId)] ?? EMPTY_LIST);

  const add = useCallback(
    (token: CustomToken) => {
      if (chainId === undefined) return;
      const current = read();
      const list = (current[String(chainId)] ?? []).filter((t) => t.address.toLowerCase() !== token.address.toLowerCase());
      write({ ...current, [String(chainId)]: [...list, token] });
    },
    [chainId],
  );

  const remove = useCallback(
    (address: Address) => {
      if (chainId === undefined) return;
      const current = read();
      const list = (current[String(chainId)] ?? []).filter((t) => t.address.toLowerCase() !== address.toLowerCase());
      write({ ...current, [String(chainId)]: list });
    },
    [chainId],
  );

  return { tokens, add, remove };
}
