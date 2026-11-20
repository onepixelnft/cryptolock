import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Store } from "../src/db.ts";
import { type Preferences, preferencesMessage, validateSaveRequest, verifyEoaSignature } from "../src/preferences.ts";
import { RateLimiter, createServer } from "../src/server.ts";
import { describeSyncError } from "../src/sync.ts";
import { confirmationsFor, rpcUrl } from "../src/config.ts";

test("Polygon is indexed out of the box, with more confirmations than other networks", () => {
  const saved = { rpc: process.env.RPC_URL_137, confirmations: process.env.CONFIRMATIONS };
  try {
    delete process.env.RPC_URL_137;
    delete process.env.CONFIRMATIONS;
    assert.match(rpcUrl(137) ?? "", /^https:\/\//);
    assert.equal(rpcUrl(31337), "http://127.0.0.1:8545");
    assert.equal(rpcUrl(42161), undefined);
    process.env.RPC_URL_137 = " https://polygon.example/key ";
    assert.equal(rpcUrl(137), "https://polygon.example/key");
    assert.equal(confirmationsFor(137, false), 16);
    assert.equal(confirmationsFor(42161, false), 2);
    assert.equal(confirmationsFor(31337, true), 0);
  } finally {
    if (saved.rpc === undefined) delete process.env.RPC_URL_137;
    else process.env.RPC_URL_137 = saved.rpc;
    if (saved.confirmations !== undefined) process.env.CONFIRMATIONS = saved.confirmations;
  }
});

const prefs: Preferences = { language: "fr", notifyMaturity: true, notifyTransactions: false, reminderDays: 3 };
const nonce = "0123456789abcdef0123456789abcdef";

async function signedBody(overrides: Partial<Record<string, unknown>> = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const issuedAt = new Date().toISOString();
  const signature = await account.signMessage({ message: preferencesMessage(account.address, prefs, issuedAt, nonce) });
  return { account, body: { address: account.address, chainId: 31337, preferences: prefs, issuedAt, nonce, signature, ...overrides } };
}

test("accepts a correctly signed preferences update", async () => {
  const { account, body } = await signedBody();
  const result = validateSaveRequest(account.address, body, Date.now(), 600_000);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(await verifyEoaSignature(result.request), true);
});

test("rejects preferences that differ from what was signed", async () => {
  const { account, body } = await signedBody({ preferences: { ...prefs, language: "en" } });
  const result = validateSaveRequest(account.address, body, Date.now(), 600_000);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(await verifyEoaSignature(result.request), false);
});

test("rejects a signature from another address", async () => {
  const { body } = await signedBody();
  const other = privateKeyToAccount(generatePrivateKey());
  const result = validateSaveRequest(other.address, { ...body, address: other.address }, Date.now(), 600_000);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(await verifyEoaSignature(result.request), false);
});

test("rejects expired or malformed requests", async () => {
  const { account, body } = await signedBody();
  assert.equal(validateSaveRequest(account.address, body, Date.now() + 3_600_000, 600_000).ok, false);
  assert.equal(validateSaveRequest(account.address, { ...body, nonce: "x" }, Date.now(), 600_000).ok, false);
  assert.equal(validateSaveRequest(account.address, { ...body, preferences: { language: "de" } }, Date.now(), 600_000).ok, false);
  assert.equal(validateSaveRequest("0x1234", body, Date.now(), 600_000).ok, false);
});

test("a nonce can only be used once", () => {
  const store = new Store(":memory:");
  const address = "0x000000000000000000000000000000000000dEaD";
  assert.equal(store.savePreferences(address, prefs, nonce), true);
  assert.equal(store.savePreferences(address, prefs, nonce), false);
  assert.deepEqual(store.getPreferences(address)?.data, prefs);
  store.close();
});

test("activity follows the current owner of a Lock Account", () => {
  const store = new Store(":memory:");
  const alice = "0x00000000000000000000000000000000000a11ce";
  const bob = "0x0000000000000000000000000000000000000b0b";
  const account = "0x00000000000000000000000000000000000acc01";
  store.upsertAccount(1, account, alice, 10);
  store.insertEvent({
    chainId: 1,
    blockNumber: 11,
    logIndex: 0,
    txHash: "0xaa",
    contract: account,
    eventName: "WalletLocked",
    owner: null,
    args: { lockIndex: "0" },
    timestamp: 1,
  });
  store.insertEvent({
    chainId: 1,
    blockNumber: 12,
    logIndex: 0,
    txHash: "0xbb",
    contract: "0x00000000000000000000000000000000000000ff",
    eventName: "Locked",
    owner: alice,
    args: { lockId: "1" },
    timestamp: 2,
  });
  assert.equal(store.activity(1, alice).events.length, 2);
  store.setAccountOwner(1, account, bob);
  assert.deepEqual(store.activity(1, alice).events.map((e) => e.eventName), ["Locked"]);
  assert.deepEqual(store.activity(1, bob).events.map((e) => e.eventName), ["WalletLocked"]);
  store.close();
});

test("activity returns the most recent events, oldest first, and says when it truncates", () => {
  const store = new Store(":memory:");
  const alice = "0x00000000000000000000000000000000000a11ce";
  for (let i = 1; i <= 5; i++) {
    store.insertEvent({
      chainId: 1,
      blockNumber: 100 + i,
      logIndex: 0,
      txHash: `0x0${i}`,
      contract: "0x00000000000000000000000000000000000000ff",
      eventName: "Locked",
      owner: alice,
      args: { lockId: String(i) },
      timestamp: i,
    });
  }
  const capped = store.activity(1, alice, 3);
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.events.map((e) => e.args.lockId), ["3", "4", "5"]);
  const all = store.activity(1, alice, 5);
  assert.equal(all.truncated, false);
  assert.equal(all.events.length, 5);
  store.close();
});

test("expired nonces are pruned, recent ones are kept", () => {
  const store = new Store(":memory:");
  const address = "0x000000000000000000000000000000000000dEaD";
  assert.equal(store.savePreferences(address, prefs, nonce), true);
  assert.equal(store.pruneNonces(new Date(Date.now() - 60_000)), 0);
  assert.equal(store.savePreferences(address, prefs, nonce), false);
  assert.equal(store.pruneNonces(new Date(Date.now() + 1_000)), 1);
  store.close();
});

test("the rate limiter allows a fixed number of requests per window and client", () => {
  const limiter = new RateLimiter(60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.hit("a", 2, t0), 0);
  assert.equal(limiter.hit("a", 2, t0 + 1), 0);
  assert.equal(limiter.hit("a", 2, t0 + 2), 60);
  assert.equal(limiter.hit("b", 2, t0 + 2), 0, "other clients are not affected");
  assert.equal(limiter.hit("a", 2, t0 + 60_000), 0, "a new window starts after a minute");
});

test("sync errors never expose RPC URLs (which often contain API keys)", () => {
  const message = describeSyncError(
    new Error("HTTP request failed.\n\nURL: https://polygon-mainnet.example.com/v2/SECRET_KEY\nRequest body: {}"),
  );
  assert.equal(message, "HTTP request failed.");
  assert.equal(describeSyncError(new Error("fetch https://rpc.example.com/v3/SECRET_KEY failed")).includes("SECRET"), false);
});

test("the API answers client mistakes with 4xx statuses", async () => {
  const store = new Store(":memory:");
  const server = createServer(store, []);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const address = "0x000000000000000000000000000000000000dEaD";
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/health`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/v1/chains/1/activity?address=0x12`)).status, 400);
    assert.equal((await fetch(`${base}/v1/chains/1/activity?address=${address}`)).status, 404);
    assert.equal((await fetch(`${base}/v1/preferences/${address}`, { method: "DELETE" })).status, 405);
    const put = (body: string, type = "application/json") =>
      fetch(`${base}/v1/preferences/${address}`, { method: "PUT", headers: { "content-type": type }, body });
    assert.equal((await put("{not json")).status, 400);
    assert.equal((await put("{}", "text/plain")).status, 415);
    assert.equal((await put(JSON.stringify({ padding: "x".repeat(20_000) }))).status, 413);
    assert.equal((await put(JSON.stringify({ address }))).status, 400);
    const response = await fetch(`${base}/v1/preferences/${address}`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await response.json(), { preferences: null, updatedAt: null });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
