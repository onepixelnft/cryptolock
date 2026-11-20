import { type Address, BaseError, type Log, type PublicClient, createPublicClient, http, parseEventLogs } from "viem";
import { lockVaultAbi, lockableAccountAbi, lockableAccountFactoryAbi, nftLockVaultAbi } from "./generated/abis.ts";
import { config, confirmationsFor, type Deployment } from "./config.ts";
import type { Store, StoredEvent } from "./db.ts";

const ACCOUNT_CHUNK = 200;
const MIN_BATCH_BLOCKS = 50;

export function describeSyncError(error: unknown): string {
  const raw = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  return raw
    .split("\n")[0]
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, "<rpc endpoint>")
    .slice(0, 200);
}

function serializeArgs(args: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (args && typeof args === "object") {
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      if (/^\d+$/.test(key)) continue;
      out[key] = typeof value === "bigint" ? value.toString() : typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  return out;
}

export class ChainSyncer {
  readonly chainId: number;
  private readonly client: PublicClient;
  private fingerprint: string | null = null;
  private readonly confirmations: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private batch = Math.max(MIN_BATCH_BLOCKS, config.batchBlocks);
  lastBlock = 0;
  head = 0;
  lastError: string | null = null;

  constructor(
    private readonly deployment: Deployment,
    rpcUrl: string,
    private readonly store: Store,
  ) {
    this.chainId = deployment.chainId;
    this.client = createPublicClient({ transport: http(rpcUrl) });
    this.confirmations = confirmationsFor(deployment.chainId, deployment.isLocal);
  }

  private async computeFingerprint(): Promise<string> {
    const block = await this.client.getBlock({ blockNumber: BigInt(this.deployment.deployBlock) });
    const { lockVault, accountFactory, nftLockVault } = this.deployment.contracts;
    return `${lockVault}:${accountFactory}:${nftLockVault ?? "-"}:${this.deployment.deployBlock}:${block.hash}`.toLowerCase();
  }

  start() {
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, config.pollIntervalMs);
    };
    void loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const head = Number(await this.client.getBlockNumber());
      this.head = head;
      if (head < this.deployment.deployBlock) return;
      this.fingerprint = await this.computeFingerprint();
      let cursor = this.store.getCursor(this.chainId);
      if (cursor && (cursor.fingerprint !== this.fingerprint || cursor.lastBlock > head)) {
        console.log(`[${this.chainId}] deployment changed or chain reset — re-indexing`);
        this.store.resetChain(this.chainId);
        this.lastBlock = 0;
        cursor = null;
      }
      let from = cursor ? cursor.lastBlock + 1 : this.deployment.deployBlock;
      const safeHead = head - this.confirmations;
      while (from <= safeHead) {
        const to = Math.min(from + this.batch - 1, safeHead);
        try {
          await this.indexRange(from, to);
        } catch (error) {
          if (this.batch <= MIN_BATCH_BLOCKS) throw error;
          this.batch = Math.max(MIN_BATCH_BLOCKS, Math.floor(this.batch / 2));
          continue;
        }
        from = to + 1;
        this.batch = Math.min(config.batchBlocks, this.batch * 2);
      }
      this.lastBlock = Math.max(this.lastBlock, Math.min(safeHead, from - 1));
      this.lastError = null;
    } catch (error) {
      this.lastError = describeSyncError(error);
      console.error(`[${this.chainId}] sync error: ${this.lastError}`);
    } finally {
      this.running = false;
    }
  }

  private async indexRange(from: number, to: number) {
    const range = { fromBlock: BigInt(from), toBlock: BigInt(to) };
    const { lockVault, accountFactory, nftLockVault } = this.deployment.contracts;

    const [factoryLogs, vaultLogs, nftLogs] = await Promise.all([
      this.client.getLogs({ address: accountFactory, ...range }),
      this.client.getLogs({ address: lockVault, ...range }),
      nftLockVault ? this.client.getLogs({ address: nftLockVault, ...range }) : Promise.resolve([] as Log[]),
    ]);
    const created = parseEventLogs({ abi: lockableAccountFactoryAbi, logs: factoryLogs, eventName: "AccountCreated" });
    for (const log of created) {
      this.store.upsertAccount(this.chainId, log.args.account, log.args.owner, Number(log.blockNumber));
    }

    const accounts = this.store.accounts(this.chainId) as Address[];
    const accountLogs: Log[] = [];
    for (let i = 0; i < accounts.length; i += ACCOUNT_CHUNK) {
      accountLogs.push(...(await this.client.getLogs({ address: accounts.slice(i, i + ACCOUNT_CHUNK), ...range })));
    }

    const vaultEvents = parseEventLogs({ abi: lockVaultAbi, logs: vaultLogs });
    const nftEvents = parseEventLogs({ abi: nftLockVaultAbi, logs: nftLogs });
    const accountEvents = parseEventLogs({ abi: lockableAccountAbi, logs: accountLogs });

    const blocks = new Set<bigint>([...vaultEvents, ...nftEvents, ...accountEvents].map((l) => l.blockNumber));
    const timestamps = new Map<bigint, number>();
    await Promise.all(
      [...blocks].map(async (blockNumber) => {
        const block = await this.client.getBlock({ blockNumber });
        timestamps.set(blockNumber, Number(block.timestamp));
      }),
    );

    type AnyEvent = (typeof vaultEvents)[number] | (typeof nftEvents)[number] | (typeof accountEvents)[number];
    const toStored = (log: AnyEvent, owner: string | null): StoredEvent => ({
      chainId: this.chainId,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      contract: log.address,
      eventName: log.eventName,
      owner,
      args: serializeArgs(log.args),
      timestamp: timestamps.get(log.blockNumber) ?? null,
    });

    this.store.transaction(() => {
      for (const log of [...vaultEvents, ...nftEvents]) {
        const args = log.args as { owner?: string };
        this.store.insertEvent(toStored(log, args.owner ?? null));
      }
      for (const log of accountEvents) {
        if (log.eventName === "OwnershipTransferred") this.store.setAccountOwner(this.chainId, log.address, log.args.newOwner);
        this.store.insertEvent(toStored(log, null));
      }
      this.store.setCursor(this.chainId, to, this.fingerprint!);
    });
    const total = vaultEvents.length + nftEvents.length + accountEvents.length;
    if (total > 0) console.log(`[${this.chainId}] blocks ${from}-${to}: ${total} events`);
  }
}
