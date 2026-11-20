import { type Abi, type Address, type PublicClient, erc20Abi } from "viem";
import { isNativeMirror } from "./assets";
import { fetchListedTokens } from "./tokenLists";

export interface DetectedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

const CALLS_PER_REQUEST = 150;
const PARALLEL_REQUESTS = 4;

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
type CallResult = { status: "success"; result: unknown } | { status: "failure" };

const MIN_SPLIT = 20;

async function multicallInChunks(client: PublicClient, calls: Call[]): Promise<{ results: CallResult[]; complete: boolean }> {
  const chunks: Call[][] = [];
  for (let i = 0; i < calls.length; i += CALLS_PER_REQUEST) chunks.push(calls.slice(i, i + CALLS_PER_REQUEST));
  const results: CallResult[][] = new Array(chunks.length);
  let complete = true;
  const run = (chunk: Call[]) => client.multicall({ contracts: chunk, allowFailure: true, batchSize: 0 }) as Promise<CallResult[]>;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      const chunk = chunks[index];
      try {
        results[index] = await run(chunk);
      } catch {
        const half = Math.ceil(chunk.length / 2);
        const parts = chunk.length >= MIN_SPLIT ? [chunk.slice(0, half), chunk.slice(half)] : [chunk];
        const settled = await Promise.allSettled(parts.map(run));
        results[index] = settled.flatMap((s, i) => {
          if (s.status === "fulfilled") return s.value;
          complete = false;
          return parts[i].map((): CallResult => ({ status: "failure" }));
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, chunks.length) }, worker));
  return { results: results.flat(), complete };
}

export interface DetectionResult {
  tokens: DetectedToken[];
  complete: boolean;
}

export async function detectHeldTokens(client: PublicClient, chainId: number, holders: Address[]): Promise<DetectionResult> {
  if (holders.length === 0) return { tokens: [], complete: true };
  const listed = (await fetchListedTokens(chainId)).filter((t) => !isNativeMirror(t.address));
  if (listed.length === 0) return { tokens: [], complete: true };

  const { results: balances, complete: balancesComplete } = await multicallInChunks(
    client,
    listed.flatMap((t) => holders.map((owner) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }))),
  );
  const held = listed.filter((_, i) =>
    holders.some((_, j) => {
      const r = balances[i * holders.length + j];
      return r.status === "success" && typeof r.result === "bigint" && r.result > 0n;
    }),
  );
  if (held.length === 0) return { tokens: [], complete: balancesComplete };

  const { results: metadata, complete: metadataComplete } = await multicallInChunks(
    client,
    held.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: "symbol" },
      { address: t.address, abi: erc20Abi, functionName: "name" },
      { address: t.address, abi: erc20Abi, functionName: "decimals" },
    ]),
  );
  const tokens: DetectedToken[] = [];
  held.forEach((t, i) => {
    const [symbol, name, decimals] = metadata.slice(i * 3, i * 3 + 3);
    if (symbol.status !== "success" || decimals.status !== "success") return;
    const s = symbol.result;
    const d = Number(decimals.result);
    if (typeof s !== "string" || s.length === 0 || s.length > 32 || !Number.isInteger(d) || d < 0 || d > 36) return;
    const n = name.status === "success" && typeof name.result === "string" && name.result.length > 0 ? name.result : s;
    tokens.push({ address: t.address, symbol: s, name: n, decimals: d });
  });
  return { tokens, complete: balancesComplete && metadataComplete };
}
