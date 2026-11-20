import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { type PublicClient, createPublicClient, http as httpTransport, isAddress } from "viem";
import { config, rpcUrl } from "./config.ts";
import type { Store } from "./db.ts";
import { preferencesMessage, validateSaveRequest, verifyEoaSignature } from "./preferences.ts";
import type { ChainSyncer } from "./sync.ts";

const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders,
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "content-type must be application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly windowMs = 60_000) {}

  hit(key: string, limit: number, now = Date.now()): number {
    if (limit <= 0) return 0;
    let entry = this.windows.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      entry = { start: now, count: 0 };
      this.windows.set(key, entry);
      if (this.windows.size > 50_000) this.prune(now);
    }
    entry.count += 1;
    if (entry.count <= limit) return 0;
    return Math.max(1, Math.ceil((entry.start + this.windowMs - now) / 1000));
  }

  private prune(now: number) {
    for (const [key, entry] of this.windows) if (now - entry.start >= this.windowMs) this.windows.delete(key);
  }
}

function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function createServer(store: Store, syncers: ChainSyncer[]) {
  const clients = new Map<number, PublicClient>();
  const clientFor = (chainId: number | null): PublicClient | null => {
    if (chainId === null) return null;
    const url = rpcUrl(chainId);
    if (!url) return null;
    if (!clients.has(chainId)) clients.set(chainId, createPublicClient({ transport: httpTransport(url) }));
    return clients.get(chainId)!;
  };
  const limiter = new RateLimiter();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "OPTIONS") return send(res, 204, null);

      const ip = clientIp(req);
      const wait = limiter.hit(`all:${ip}`, config.rateLimitPerMinute);
      if (wait) return send(res, 429, { error: "too many requests" }, { "retry-after": String(wait) });

      if (url.pathname === "/health") {
        if (req.method !== "GET") return send(res, 405, { error: "method not allowed" }, { allow: "GET" });
        return send(res, 200, {
          ok: true,
          chains: syncers.map((s) => ({ chainId: s.chainId, indexedBlock: s.lastBlock, head: s.head, error: s.lastError })),
        });
      }

      if (parts[0] === "v1" && parts[1] === "chains" && parts[3] === "activity" && parts.length === 4) {
        if (req.method !== "GET") return send(res, 405, { error: "method not allowed" }, { allow: "GET" });
        const chainId = Number(parts[2]);
        const address = url.searchParams.get("address") ?? "";
        if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isAddress(address)) {
          return send(res, 400, { error: "invalid chain or address" });
        }
        if (!syncers.some((s) => s.chainId === chainId)) return send(res, 404, { error: "chain not indexed" });
        const { events, truncated } = store.activity(chainId, address, config.maxActivityEvents);
        return send(res, 200, { events, truncated });
      }

      if (parts[0] === "v1" && parts[1] === "preferences" && parts.length === 3) {
        const address = parts[2];
        if (!isAddress(address)) return send(res, 400, { error: "invalid address" });

        if (req.method === "GET") {
          const stored = store.getPreferences(address);
          return send(res, 200, { preferences: stored?.data ?? null, updatedAt: stored?.updatedAt ?? null });
        }

        if (req.method === "PUT") {
          const writeWait = limiter.hit(`write:${ip}`, config.writeRateLimitPerMinute);
          if (writeWait) return send(res, 429, { error: "too many requests" }, { "retry-after": String(writeWait) });

          const validation = validateSaveRequest(address, await readJson(req), Date.now(), config.signatureMaxAgeMs);
          if (!validation.ok) return send(res, 400, { error: validation.error });
          const request = validation.request;
          const message = preferencesMessage(request.address, request.preferences, request.issuedAt, request.nonce);

          let valid = await verifyEoaSignature(request);
          if (!valid) {
            const client = clientFor(request.chainId);
            if (client) {
              valid = await client
                .verifyMessage({ address: request.address, message, signature: request.signature })
                .catch(() => false);
            }
          }
          if (!valid) return send(res, 401, { error: "invalid signature" });
          if (!store.savePreferences(address, request.preferences, request.nonce)) return send(res, 409, { error: "nonce already used" });
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: "method not allowed" }, { allow: "GET, PUT" });
      }

      return send(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      console.error(error);
      return send(res, 500, { error: "internal error" });
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
