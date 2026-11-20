import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:4000";
const ACCOUNT = process.env.E2E_ACCOUNT ?? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OUT = path.resolve(process.env.ARTIFACTS_DIR ?? path.join(import.meta.dirname, "artifacts"));
const DAY = 86_400;
const DEPLOYMENTS = path.resolve(import.meta.dirname, "..", "web", "src", "config", "deployments.json");

function localDeployment() {
  const all = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
  if (!all["31337"]) throw new Error("No local deployment: run `npm run deploy:local` in ../contracts first.");
  return all["31337"];
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chrome/Chromium found. Set CHROME_PATH.");
  return found;
}

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function injectWallet(rpcUrl, account, chainIdHex) {
  const listeners = {};
  let id = 0;
  const forward = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const json = await response.json();
    if (json.error) {
      const error = new Error(json.error.message);
      error.code = json.error.code;
      error.data = json.error.data;
      throw error;
    }
    return json.result;
  };
  window.ethereum = {
    isE2EWallet: true,
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account];
        case "eth_chainId":
          return chainIdHex;
        case "wallet_switchEthereumChain":
        case "wallet_revokePermissions":
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        default:
          return forward(method, params);
      }
    },
    on: (event, fn) => {
      (listeners[event] ||= []).push(fn);
    },
    removeListener: (event, fn) => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
  };
}

const steps = [];
let onFailure = async () => {};
async function step(name, fn) {
  const started = Date.now();
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
  } catch (error) {
    console.log("FAILED");
    await onFailure(name).catch(() => {});
    throw error;
  }
  steps.push(name);
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lock-e2e-"));
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    userDataDir: profile,
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1366,900"],
  });
  try {
    await scenario(browser);
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function scenario(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  await page.evaluateOnNewDocument(injectWallet, RPC, ACCOUNT, "0x7a69");
  await page.evaluateOnNewDocument(() => {
    const key = "lock.preferences.v1";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ language: "en", notifyMaturity: false, reminderDays: 3, notifyTransactions: true }));
    }
  });

  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 450));
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };
  onFailure = async (name) => {
    await page.screenshot({ path: path.join(OUT, `FAILED-${name.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: true });
    if (problems.length > 0) console.log(problems.slice(-10).map((p) => `  - ${p}`).join("\n"));
  };
  const waitText = (text, timeout = 30_000) =>
    page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
  const click = async (text, { scope = "", exact = false, timeout = 20_000 } = {}) => {
    const handle = await page.waitForFunction(
      (scopeSel, txt, ex) => {
        const root = scopeSel ? document.querySelector(scopeSel) : document;
        if (!root) return null;
        const wanted = txt.toLowerCase();
        return (
          [...root.querySelectorAll("button, a, label, summary")].find((el) => {
            const label = (el.innerText || "").trim().toLowerCase();
            const match = ex ? label === wanted : label.includes(wanted);
            return match && !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.getClientRects().length > 0;
          }) ?? null
        );
      },
      { timeout },
      scope,
      text,
      exact,
    );
    await handle.asElement().click();
  };
  const typeInto = async (selector, value) => {
    await page.waitForSelector(selector, { visible: true });
    await page.focus(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
  };

  await step("landing page, without any RPC traffic before a wallet is connected", async () => {
    const rpcRequests = [];
    const onRequest = (request) => {
      if (request.url().startsWith(RPC)) rpcRequests.push(request.url());
    };
    page.on("request", onRequest);
    await page.goto(APP, { waitUntil: "networkidle2" });
    await waitText("Lock it. Keep it.");
    await new Promise((r) => setTimeout(r, 3_000));
    page.off("request", onRequest);
    if (rpcRequests.length > 0) throw new Error(`${rpcRequests.length} RPC request(s) sent before connecting a wallet`);
    await shot("01-landing");
  });

  await step("connect the wallet", async () => {
    await click("Connect wallet");
    await click("Browser wallet");
    await waitText("Total Locked");
    await waitText("My Locks");
    await shot("02-dashboard");
  });

  await step("network list: Polygon only, plus the local development network", async () => {
    await click("Hardhat", { scope: ".header" });
    await page.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll(".modal .option-row")].map((row) => row.textContent ?? "");
        return (
          rows.length === 2 &&
          rows.some((row) => row.includes("Polygon") && row.includes("Main network")) &&
          rows.some((row) => row.includes("Hardhat") && row.includes("Local"))
        );
      },
      { timeout: 10_000 },
    );
    await shot("02b-network-list");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 5_000 });
  });

  await step("crypto lock: 5,000 USDC, staked, 90 days", async () => {
    await click("+ Create Lock");
    await waitText("What do you want to lock?");
    await shot("03-create-type");
    await click("Lock a Crypto");
    await waitText("Select a cryptocurrency");
    await click("USD Coin (test)");
    await click("Custom amount");
    await typeInto("input.input-lg", "5000");
    await shot("04-create-asset");
    await click("Continue");
    await waitText("Do you want to stake your locked assets?");
    await click("YES — Enable Staking");
    await shot("05-create-staking");
    await click("Continue");
    await click("90 Days", { exact: true });
    await waitText("Unlock date");
    await shot("06-create-duration");
    await click("Continue");
    await waitText("Early unlock is possible, but not free");
    await page.click(".check input");
    await shot("07-create-review");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await shot("08-create-confirmed");
  });

  await step("lock detail and early unlock (fee taken by the contract)", async () => {
    await click("View the lock");
    await waitText("Unlock at Maturity");
    await shot("09-lock-detail");
    await click("Unlock Early");
    await waitText("Estimated amount received");
    await click("See the calculation");
    await shot("10-early-unlock");
    await click("Pay the fee and unlock", { scope: ".modal" });
    await waitText("Unlocked. The assets are back", 60_000);
    await waitText("Early unlocked");
    await shot("11-early-unlocked");
  });

  await step("crypto lock of a token added by address (not in the network list)", async () => {
    const [unlisted] = localDeployment().devUnlistedTokens ?? [];
    if (!unlisted) throw new Error("the local deployment has no unlisted test token");
    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock a Crypto");
    await waitText("Add a token by address");
    await typeInto('input[aria-label="Add a token by address"]', unlisted);
    await click("Add", { exact: true });
    await waitText("TUT added to your list.");
    await waitText("Unlisted Token (test)");
    await click("Custom amount");
    await typeInto("input.input-lg", "10");
    await shot("11b-custom-token");
    await click("Continue");
    await waitText("Staking is not available for TUT");
    await click("NO — Lock Only");
    await click("Continue");
    await click("14 Days", { exact: true });
    await click("Continue");
    await page.click(".check input");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await page.goto(APP, { waitUntil: "networkidle2" });
    await waitText("Unlisted Token (test)");
  });

  await step("terms raised during the review: refused on-chain, new terms shown, lock with them", async () => {
    const { protocolConfig } = localDeployment().contracts;
    const admin = (await rpc("eth_accounts"))[0];
    const setFees = async (min, max) => {
      const word = (n) => n.toString(16).padStart(64, "0");
      const hash = await rpc("eth_sendTransaction", [
        { from: admin, to: protocolConfig, data: `0x295e1ea5${word(min)}${word(max)}` },
      ]);
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (receipt?.status !== "0x1") throw new Error("setEarlyUnlockFee failed");
    };

    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock a Crypto");
    await click("USD Coin (test)");
    await click("Custom amount");
    await typeInto("input.input-lg", "100");
    await click("Continue");
    await click("NO — Lock Only");
    await click("Continue");
    await click("30 Days", { exact: true });
    await click("Continue");
    await waitText("5.00%");
    await page.click(".check input");

    try {
      await setFees(100, 600);
      await click("Confirm and lock");
      await waitText("The early-unlock terms changed since you reviewed them", 30_000);
      await waitText("The protocol terms changed while this review was open", 30_000);
      await shot("11c-terms-changed");
      await click("Show the new terms");
      await waitText("6.00%");
      await page.click(".check input");
      await click("Confirm and lock");
      await waitText("Lock confirmed on-chain", 60_000);
      await click("View the lock");
      await waitText("6.00% → 1.00%");
    } finally {
      await setFees(100, 500);
    }
  });

  await step("NFT lock (ERC-721): lock a collectible, then unlock early paying the native fee", async () => {
    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock an NFT");
    await waitText("Your NFTs from known collections");
    await click("Test Collectible #4", { timeout: 30_000 });
    await waitText("Selected NFT");
    await shot("11c-nft-select");
    await click("Continue");
    await waitText("Staking is not available for NFTs");
    await click("Continue");
    await click("30 Days", { exact: true });
    await click("Continue");
    await waitText("Early unlock is possible, but not free");
    await page.click(".check input");
    await shot("11d-nft-review");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await click("View the lock");
    await waitText("NFT Lock #1");
    await shot("11e-nft-detail");
    await click("Unlock Early");
    await waitText("Early unlock fee");
    await shot("11f-nft-early-unlock");
    await click("Pay the fee and unlock", { scope: ".modal" });
    await waitText("Unlocked. The assets are back", 60_000);
    await waitText("Early unlocked");
  });

  await step("NFT lock (ERC-1155): lock 2 editions for 7 days, withdraw at maturity", async () => {
    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock an NFT");
    await click("Test Edition #1", { timeout: 30_000 });
    await waitText("Number of units to lock");
    await typeInto('input[aria-label="Number of units to lock"]', "2");
    await click("Continue");
    await click("Continue");
    await click("7 Days", { exact: true });
    await click("Continue");
    await page.click(".check input");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await click("View the lock");
    await waitText("NFT Lock #2");
    await rpc("evm_increaseTime", [8 * DAY]);
    await rpc("evm_mine", []);
    await page.reload({ waitUntil: "networkidle2" });
    await waitText("Ready to unlock", 30_000);
    await click("Unlock at Maturity");
    await waitText("Withdrawn. The assets were returned", 60_000);
  });

  await step("crypto lock: 1 ETH, lock only, 7 days, then withdrawal at maturity", async () => {
    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock a Crypto");
    await click("Ether");
    await click("Custom amount");
    await typeInto("input.input-lg", "1");
    await click("Continue");
    await click("NO — Lock Only");
    await click("Continue");
    await click("7 Days", { exact: true });
    await click("Continue");
    await page.click(".check input");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await click("View the lock");
    await waitText("Unlock at Maturity");
    await rpc("evm_increaseTime", [8 * DAY]);
    await rpc("evm_mine", []);
    await page.reload({ waitUntil: "networkidle2" });
    await waitText("Ready to unlock", 30_000);
    await click("Unlock at Maturity");
    await waitText("Withdrawn. The assets were returned", 60_000);
    await shot("12-withdrawn");
  });

  await step("staked lock whose vault cannot pay out at maturity: receive the vault shares", async () => {
    const sUsdc = localDeployment().tokens.find((t) => t.symbol === "sUSDC")?.address;
    if (!sUsdc) throw new Error("the local deployment has no sUSDC test vault");
    const admin = (await rpc("eth_accounts"))[0];
    const pauseRedemptions = async (paused) => {
      const hash = await rpc("eth_sendTransaction", [
        { from: admin, to: sUsdc, data: `0x0da254b4${(paused ? 1 : 0).toString(16).padStart(64, "0")}` },
      ]);
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (receipt?.status !== "0x1") throw new Error("setRedemptionsPaused failed");
    };

    await page.goto(`${APP}/create`, { waitUntil: "networkidle2" });
    await click("Lock a Crypto");
    await click("USD Coin (test)");
    await click("Custom amount");
    await typeInto("input.input-lg", "200");
    await click("Continue");
    await click("YES — Enable Staking");
    await click("Continue");
    await click("7 Days", { exact: true });
    await click("Continue");
    await page.click(".check input");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await click("View the lock");
    await waitText("Unlock at Maturity");

    try {
      await pauseRedemptions(true);
      await rpc("evm_increaseTime", [8 * DAY]);
      await rpc("evm_mine", []);
      await page.reload({ waitUntil: "networkidle2" });
      await waitText("Ready to unlock", 30_000);
      await waitText("The staking vault cannot pay out right now", 30_000);
      await shot("12b-vault-cannot-redeem");
      await click("Receive the vault shares");
      await waitText("Withdrawn as vault shares", 60_000);
      await waitText("sUSDC");
    } finally {
      await pauseRedemptions(false);
    }
  });

  await step("wallet lock: create the Lock Account and deposit", async () => {
    await page.goto(`${APP}/wallet`, { waitUntil: "networkidle2" });
    await waitText("don't have a Lock Account");
    await shot("13-wallet-not-created");
    await click("Create my Lock Account");
    await waitText("Lock this wallet", 60_000);
    for (const [symbol, amount] of [
      ["ETH", "2"],
      ["USDC", "1000"],
    ]) {
      await click("Deposit");
      await page.waitForSelector(".modal");
      await click(symbol, { scope: ".modal" });
      await typeInto(".modal input.input", amount);
      await click("Deposit", { scope: ".modal-foot", exact: true });
      await page.waitForFunction(() => document.querySelector(".modal")?.innerText.includes("Confirmed"), { timeout: 60_000 });
      await click("Close", { scope: ".modal-foot", exact: true });
    }
    await waitText("USD Coin (test)");
    await shot("14-wallet-funded");
  });

  await step("wallet lock: lock 30 days with staking", async () => {
    await click("Lock this wallet");
    await waitText("How Wallet Lock works");
    await shot("15-wallet-step");
    await click("Continue");
    await waitText("Eligible assets in your Lock Account");
    await click("YES — Enable Staking");
    await shot("16-wallet-staking");
    await click("Continue");
    await click("30 Days", { exact: true });
    await click("Continue");
    await page.click(".check input");
    await click("Confirm and lock");
    await waitText("Lock confirmed on-chain", 60_000);
    await page.goto(`${APP}/wallet`, { waitUntil: "networkidle2" });
    await waitText("Locked until");
    const withdrawDisabled = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => /withdraw|unstake/i.test(b.innerText)).every((b) => b.disabled),
    );
    if (!withdrawDisabled) throw new Error("withdraw buttons must be disabled while locked");
    await shot("17-wallet-locked");
  });

  await step("wallet lock: early unlock with per-asset fees", async () => {
    await click("Unlock Early");
    await waitText("Fee per asset");
    await shot("18-wallet-early-unlock");
    await click("Pay the fee and unlock", { scope: ".modal" });
    await waitText("Unlocked. The assets are back", 60_000);
    await shot("19-wallet-unlocked");
  });

  await step("history with filters", async () => {
    await page.goto(`${APP}/history`, { waitUntil: "networkidle2" });
    await waitText("Every lock, read from the smart contracts");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 3, { timeout: 30_000 });
    await shot("20-history");
    await click("Early Unlocked", { exact: true });
    await shot("21-history-early");
  });

  await step("settings: signed preferences and French", async () => {
    await page.goto(`${APP}/settings`, { waitUntil: "networkidle2" });
    await waitText("Notifications");
    const canSync = await page.evaluate(() => document.body.innerText.includes("Save to my address"));
    if (canSync) {
      await click("Save to my address");
      await waitText("Preferences saved for your address", 30_000);
    }
    await click("Français");
    await waitText("Paramètres");
    await shot("22-settings-fr");
    await page.goto(APP, { waitUntil: "networkidle2" });
    await waitText("Tableau de bord");
    await shot("23-dashboard-fr");
  });

  await step("mobile layout (390 px): no horizontal scroll", async () => {
    await page.setViewport({ width: 390, height: 844 });
    for (const [route, name] of [
      ["/", "24-mobile-dashboard"],
      ["/history", "25-mobile-history"],
      ["/create", "26-mobile-create"],
      ["/wallet", "27-mobile-wallet"],
    ]) {
      await page.goto(`${APP}${route}`, { waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 800));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`${route} overflows horizontally by ${overflow}px`);
      await shot(name);
    }
  });

  await step("indexer recorded the activity", async () => {
    try {
      const response = await fetch(`${INDEXER}/v1/chains/31337/activity?address=${ACCOUNT}`);
      const body = await response.json();
      const names = new Set((body.events ?? []).map((e) => e.eventName));
      for (const expected of [
        "Locked",
        "UnlockedEarly",
        "Withdrawn",
        "WalletLocked",
        "WalletUnlockedEarly",
        "NftLocked",
        "NftUnlockedEarly",
        "NftWithdrawn",
      ]) {
        if (!names.has(expected)) throw new Error(`missing ${expected} in indexed activity`);
      }
    } catch (error) {
      if (error instanceof TypeError) console.log("(indexer not running — skipped)");
      else throw error;
    }
  });

  const relevant = problems.filter((p) => !/Download the React DevTools/.test(p));
  console.log(`\n${steps.length} steps passed. Screenshots: ${OUT}`);
  if (relevant.length > 0) {
    console.log(`\nBrowser errors (${relevant.length}):`);
    for (const p of [...new Set(relevant)].slice(0, 30)) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exitCode = 1;
});
