const [url, timeoutArg = "60", mode] = process.argv.slice(2);
if (!url) {
  console.error("usage: node wait-for.mjs <url> [timeoutSeconds] [--rpc]");
  process.exit(2);
}

const deadline = Date.now() + Number(timeoutArg) * 1000;

async function answers() {
  try {
    const response =
      mode === "--rpc"
        ? await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
            signal: AbortSignal.timeout(5_000),
          })
        : await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return response.ok;
  } catch {
    return false;
  }
}

while (Date.now() < deadline) {
  if (await answers()) process.exit(0);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
process.exit(1);
