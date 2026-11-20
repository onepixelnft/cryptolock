import { formatUnits, parseUnits } from "viem";

const decimalSeparatorCache = new Map<string, string>();
function decimalSeparator(locale: string): string {
  let sep = decimalSeparatorCache.get(locale);
  if (!sep) {
    sep = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
    decimalSeparatorCache.set(locale, sep);
  }
  return sep;
}

export function formatAmount(value: bigint, decimals: number, locale: string, maxFraction = 4): string {
  const negative = value < 0n;
  const raw = formatUnits(negative ? -value : value, decimals);
  const [intPart, fracPart = ""] = raw.split(".");
  let digits = maxFraction;
  if (intPart === "0" && fracPart.length > 0) {
    const firstSignificant = fracPart.search(/[1-9]/);
    if (firstSignificant >= 0) digits = Math.max(digits, Math.min(decimals, firstSignificant + 3));
  }
  const fraction = fracPart.slice(0, digits).replace(/0+$/, "");
  const grouped = new Intl.NumberFormat(locale).format(BigInt(intPart));
  return `${negative ? "-" : ""}${grouped}${fraction ? decimalSeparator(locale) + fraction : ""}`;
}

export function formatToken(value: bigint, decimals: number, symbol: string, locale: string): string {
  return `${formatAmount(value, decimals, locale)} ${symbol}`;
}

export function formatUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatUsdCompact(value: number, locale: string): string {
  if (Math.abs(value) < 1_000_000) return formatUsd(value, locale);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatBps(bps: number | bigint, locale: string): string {
  return `${(Number(bps) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDate(seconds: number, locale: string, withTime = true): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(seconds * 1000));
}

export function formatShortDate(seconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(seconds * 1000));
}

export function splitDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3_600),
    minutes: Math.floor((s % 3_600) / 60),
    seconds: s % 60,
  };
}

export function parseAmount(input: string, decimals: number): bigint | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === "" || normalized === ".") return null;
  const [, frac = ""] = normalized.split(".");
  if (frac.length > decimals) return null;
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return null;
  }
}

export function toFloat(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}
