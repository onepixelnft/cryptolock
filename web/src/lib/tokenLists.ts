import { type Address, getAddress, isAddress } from "viem";

export interface ListedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

const COINGECKO_PLATFORMS: Record<number, string> = {
  1: "ethereum",
  10: "optimistic-ethereum",
  25: "cronos",
  30: "rootstock",
  40: "telos",
  56: "binance-smart-chain",
  100: "xdai",
  122: "fuse",
  130: "unichain",
  137: "polygon-pos",
  143: "monad",
  146: "sonic",
  169: "manta-pacific",
  196: "x-layer",
  204: "opbnb",
  252: "fraxtal",
  288: "boba",
  360: "shape",
  480: "world-chain",
  747: "flow-evm",
  999: "hyperevm",
  1088: "metis-andromeda",
  1284: "moonbeam",
  1285: "moonriver",
  1329: "sei-v2",
  1868: "soneium",
  1923: "swellchain",
  2222: "kava",
  2818: "morph-l2",
  4326: "megaeth",
  5000: "mantle",
  5330: "superseed",
  8217: "klay-token",
  8453: "base",
  8822: "iota-evm",
  9745: "plasma",
  33139: "apechain",
  34443: "mode",
  42161: "arbitrum-one",
  42170: "arbitrum-nova",
  42220: "celo",
  43111: "hemi",
  43114: "avalanche",
  48900: "zircuit",
  57073: "ink",
  59144: "linea",
  80094: "berachain",
  81457: "blast",
  534352: "scroll",
  747474: "katana",
  7777777: "zora-network",
  21000000: "corn",
  666666666: "degen",
  1313161554: "aurora",
};

const UNISWAP_LIST = "https://tokens.uniswap.org";
const UNISWAP_CHAINS = new Set([130, 11155111]);
const SUPERCHAIN_LIST = "https://static.optimism.io/optimism.tokenlist.json";
const SUPERCHAIN_CHAINS = new Set([1135, 1750, 4202, 84532, 11155111, 11155420]);

const CACHE_PREFIX = "lock.tokenList.v1.";
const CACHE_TTL_MS = 24 * 3_600_000;
const FETCH_TIMEOUT_MS = 20_000;

function overrides(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(process.env.NEXT_PUBLIC_TOKEN_LISTS || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, urls]) => Array.isArray(urls))
        .map(([chainId, urls]) => [chainId, (urls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("https://"))]),
    );
  } catch {
    return {};
  }
}

export function tokenListUrls(chainId: number): string[] {
  const custom = overrides()[String(chainId)];
  if (custom) return custom;
  const urls: string[] = [];
  const platform = COINGECKO_PLATFORMS[chainId];
  if (platform) urls.push(`https://tokens.coingecko.com/${platform}/all.json`);
  if (UNISWAP_CHAINS.has(chainId)) urls.push(UNISWAP_LIST);
  if (SUPERCHAIN_CHAINS.has(chainId)) urls.push(SUPERCHAIN_LIST);
  return urls;
}

function parseEntry(raw: unknown, chainId: number): ListedToken | null {
  const t = raw as Record<string, unknown>;
  if (!t || t.chainId !== chainId || typeof t.address !== "string" || !isAddress(t.address)) return null;
  if (typeof t.symbol !== "string" || t.symbol.length === 0 || t.symbol.length > 32) return null;
  if (typeof t.decimals !== "number" || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) return null;
  const name = typeof t.name === "string" && t.name.length <= 80 ? t.name : t.symbol;
  return { address: getAddress(t.address), symbol: t.symbol, name, decimals: t.decimals };
}

async function fetchList(url: string, chainId: number): Promise<ListedToken[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`token list ${response.status}`);
    const body = (await response.json()) as { tokens?: unknown };
    if (!Array.isArray(body.tokens)) return [];
    return body.tokens.map((entry) => parseEntry(entry, chainId)).filter((t): t is ListedToken => t !== null);
  } finally {
    clearTimeout(timer);
  }
}

type CachedList = { at: number; tokens: Array<[Address, string, string, number]> };

function readCache(chainId: number): ListedToken[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + chainId);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedList;
    if (!(Date.now() - cached.at < CACHE_TTL_MS) || !Array.isArray(cached.tokens)) return null;
    return cached.tokens
      .map(([address, symbol, name, decimals]) => parseEntry({ chainId, address, symbol, name, decimals }, chainId))
      .filter((t): t is ListedToken => t !== null);
  } catch {
    return null;
  }
}

function writeCache(chainId: number, tokens: ListedToken[]) {
  try {
    const value: CachedList = { at: Date.now(), tokens: tokens.map((t) => [t.address, t.symbol, t.name, t.decimals]) };
    window.localStorage.setItem(CACHE_PREFIX + chainId, JSON.stringify(value));
  } catch {
  }
}

export async function fetchListedTokens(chainId: number): Promise<ListedToken[]> {
  const cached = readCache(chainId);
  if (cached) return cached;
  const urls = tokenListUrls(chainId);
  if (urls.length === 0) return [];
  const results = await Promise.allSettled(urls.map((url) => fetchList(url, chainId)));
  const byAddress = new Map<string, ListedToken>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const token of result.value) {
      if (!byAddress.has(token.address.toLowerCase())) byAddress.set(token.address.toLowerCase(), token);
    }
  }
  const tokens = [...byAddress.values()];
  if (results.every((r) => r.status === "fulfilled")) writeCache(chainId, tokens);
  return tokens;
}
