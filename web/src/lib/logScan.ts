import { type Address, type Hex, type Log, type PublicClient, formatLog, numberToHex } from "viem";

const MAX_CHUNK = 50_000n;
const MIN_CHUNK = 500n;
const REORG_MARGIN = 12n;

interface Entry {
  next: bigint;
  logs: Log[];
  chunk: bigint;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Log[]>>();

export interface LogQuery {
  key: string;
  address: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock: bigint;
}

async function fetchRange(client: PublicClient, query: LogQuery, from: bigint, to: bigint): Promise<Log[]> {
  const raw = await client.request(
    {
      method: "eth_getLogs",
      params: [{ address: query.address, topics: query.topics, fromBlock: numberToHex(from), toBlock: numberToHex(to) }],
    },
    { retryCount: 0 },
  );
  return (raw as Parameters<typeof formatLog>[0][]).map((log) => formatLog(log));
}

async function scan(client: PublicClient, query: LogQuery): Promise<Log[]> {
  const head = await client.getBlockNumber();
  let entry = cache.get(query.key);
  if (!entry || entry.next > head + 1n) entry = { next: query.fromBlock, logs: [], chunk: MAX_CHUNK };

  const start = entry.next > query.fromBlock + REORG_MARGIN ? entry.next - REORG_MARGIN : query.fromBlock;
  const kept = entry.logs.filter((log) => log.blockNumber !== null && log.blockNumber < start);
  const found: Log[] = [];
  let chunk = entry.chunk;
  let from = start;
  while (from <= head) {
    const to = from + chunk - 1n < head ? from + chunk - 1n : head;
    try {
      found.push(...(await fetchRange(client, query, from, to)));
      from = to + 1n;
    } catch (error) {
      if (chunk <= MIN_CHUNK) {
        cache.set(query.key, { next: from, logs: [...kept, ...found], chunk });
        throw error;
      }
      chunk = chunk / 2n;
    }
  }

  const logs = [...kept, ...found];
  cache.set(query.key, { next: head + 1n, logs, chunk });
  return logs;
}

export function scanLogs(client: PublicClient, query: LogQuery): Promise<Log[]> {
  const pending = inFlight.get(query.key);
  if (pending) return pending;
  const promise = scan(client, query).finally(() => inFlight.delete(query.key));
  inFlight.set(query.key, promise);
  return promise;
}
