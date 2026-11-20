import { PROTOCOL_VERSION, config, loadDeployments, rpcUrl, skipLocal } from "./config.ts";
import { Store } from "./db.ts";
import { createServer } from "./server.ts";
import { ChainSyncer } from "./sync.ts";

const store = new Store(config.dbPath);
const syncers: ChainSyncer[] = [];

for (const deployment of loadDeployments()) {
  if (skipLocal && deployment.isLocal) continue;
  if ((deployment.protocolVersion ?? 1) !== PROTOCOL_VERSION) {
    console.warn(
      `[${deployment.chainId}] ${deployment.name}: contracts v${deployment.protocolVersion ?? 1}, ` +
        `this indexer reads v${PROTOCOL_VERSION} — not indexed (redeploy the contracts on this network)`,
    );
    continue;
  }
  const url = rpcUrl(deployment.chainId);
  if (!url) {
    console.warn(`[${deployment.chainId}] ${deployment.name}: no RPC_URL_${deployment.chainId} set — not indexed`);
    continue;
  }
  const syncer = new ChainSyncer(deployment, url, store);
  syncers.push(syncer);
  syncer.start();
  console.log(`[${deployment.chainId}] indexing ${deployment.name} from block ${deployment.deployBlock}`);
}
if (syncers.length === 0) console.warn("No deployment to index. Run contracts/scripts/deploy.ts first.");

const server = createServer(store, syncers);
server.listen(config.port, config.host, () => {
  console.log(`Indexer API listening on http://${config.host}:${config.port}`);
});

const pruneNonces = () => {
  const removed = store.pruneNonces(new Date(Date.now() - config.signatureMaxAgeMs - 5 * 60_000));
  if (removed > 0) console.log(`pruned ${removed} expired preference nonces`);
};
const pruneTimer = setInterval(pruneNonces, 60 * 60_000);
pruneTimer.unref();

function shutdown() {
  clearInterval(pruneTimer);
  for (const s of syncers) s.stop();
  server.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
