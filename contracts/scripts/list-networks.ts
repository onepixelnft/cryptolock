import { PRIMARY_NETWORK_KEY, PRIMARY_TESTNET_KEY, orderedNetworks } from "./networks";
import { PROTOCOL_VERSION, readDeployments, readPendingDeployment } from "./lib/deployment-file";

function main() {
  const deployed = readDeployments();
  const rows = orderedNetworks();
  console.log(`${"#".padEnd(4)}${"KEY".padEnd(22)}${"CHAIN ID".padEnd(12)}${"COIN".padEnd(9)}${"TYPE".padEnd(10)}${"NETWORK".padEnd(34)}STATE`);
  rows.forEach((net, i) => {
    const deployment = deployed[String(net.chain.id)];
    const state = readPendingDeployment(net.chain.id)
      ? "interrupted deployment"
      : !deployment
        ? ""
        : deployment.protocolVersion === PROTOCOL_VERSION
          ? `deployed (v${PROTOCOL_VERSION})`
          : `old version (v${deployment.protocolVersion ?? 1}): redeploy`;
    const name =
      net.key === PRIMARY_NETWORK_KEY ? `${net.chain.name} - MAIN` : net.key === PRIMARY_TESTNET_KEY ? `${net.chain.name} - main testnet` : net.chain.name;
    console.log(
      `${String(i + 1).padEnd(4)}${net.key.padEnd(22)}${String(net.chain.id).padEnd(12)}${net.chain.nativeCurrency.symbol.padEnd(9)}` +
        `${(net.chain.testnet ? "testnet" : "mainnet").padEnd(10)}${name.padEnd(34)}${state}`,
    );
  });
  const mainnets = rows.filter((n) => !n.chain.testnet).length;
  console.log(`\n${rows.length} networks: ${mainnets} main networks (real coins) and ${rows.length - mainnets} test networks (free coins).`);
}

main();
