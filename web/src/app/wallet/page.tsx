"use client";

import { useState } from "react";
import Link from "next/link";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { type Address, encodeFunctionData, erc20Abi, isAddress } from "viem";
import { erc4626Abi, lockableAccountAbi, lockableAccountFactoryAbi } from "@/generated/abis";
import { ApprovalsList } from "@/components/ApprovalsList";
import { DepositModal } from "@/components/DepositModal";
import { Modal } from "@/components/Modal";
import { RequireReady } from "@/components/RequireReady";
import { TokenIcon } from "@/components/TokenIcon";
import { WalletEarlyUnlockModal } from "@/components/WalletEarlyUnlockModal";
import {
  AddressLink,
  Countdown,
  DetailRow,
  type LockState,
  Notice,
  SectionHead,
  Skeleton,
  StatusChip,
  TxProgress,
} from "@/components/ui";
import { type LockAccountState, useAssets, useBalances, useLockAccount, useMarket, usdValue } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useTxFlow } from "@/hooks/useTxFlow";
import type { Asset } from "@/lib/assets";
import { useChainNow } from "@/lib/chainClock";
import { feeBpsAt } from "@/lib/fees";
import { formatAmount, formatBps, formatDate, formatUsd, parseAmount } from "@/lib/format";
import { formatDurationLong, formatDurationShort, useI18n } from "@/lib/i18n";

export default function WalletPage() {
  return (
    <div className="container page">
      <RequireReady>
        <WalletLock />
      </RequireReady>
    </div>
  );
}

function WalletLock() {
  const { t, locale } = useI18n();
  const config = useConfig();
  const now = useChainNow();
  const { address, deployment, chain, chainId } = useNetwork();
  const query = useLockAccount(address);
  const account = query.data;
  const balances = useBalances(account?.deployed ? account.address : undefined).data;
  const market = useMarket().data;
  const { assets } = useAssets();
  const flow = useTxFlow();
  const [depositOpen, setDepositOpen] = useState(false);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyDone, setEarlyDone] = useState(false);
  const [withdrawAsset, setWithdrawAsset] = useState<Asset | null>(null);

  if (query.isLoading || !account) {
    return (
      <div className="stack-16">
        <Skeleton width="40%" height={36} />
        <Skeleton height={160} />
      </div>
    );
  }

  const current = account.locks[0];
  const maturedPending = !!current && current.status === "active" && now >= current.end;
  const state: LockState = !account.deployed ? "notCreated" : account.isLocked ? "active" : maturedPending ? "unlockable" : "unlocked";
  const held = assets.filter((a) => (balances?.[a.key] ?? 0n) > 0n);
  const isOwner = !!address && !!account.owner && account.owner.toLowerCase() === address.toLowerCase();

  const send = (id: string, label: string, write: () => Promise<`0x${string}`>) => flow.run([{ id, label, send: write }]);

  const createAccount = () =>
    send("create-account", t("create.tx.createAccount"), async () => {
      const { request } = await simulateContract(config, {
        address: deployment!.contracts.accountFactory,
        abi: lockableAccountFactoryAbi,
        functionName: "createAccount",
        args: [address!, 0n],
        account: address,
      });
      return writeContract(config, request);
    });

  const completeLock = () =>
    send("complete-lock", t("walletPage.completeLock"), async () => {
      const { request } = await simulateContract(config, {
        address: account.address,
        abi: lockableAccountAbi,
        functionName: "completeLock",
        account: address,
      });
      return writeContract(config, request);
    });

  const unstake = (vault: Asset) =>
    send(`unstake-${vault.key}`, `${t("walletPage.unstake")} ${vault.symbol}`, async () => {
      const shares = balances?.[vault.key] ?? 0n;
      const data = encodeFunctionData({ abi: erc4626Abi, functionName: "redeem", args: [shares, account.address, account.address] });
      const { request } = await simulateContract(config, {
        address: account.address,
        abi: lockableAccountAbi,
        functionName: "execute",
        args: [vault.address, 0n, data],
        account: address,
      });
      return writeContract(config, request);
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t("common.lockAccount")}</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            {t("walletPage.title")}
          </h1>
          <p className="lead muted">{t("walletPage.lead")}</p>
        </div>
        <StatusChip state={state} />
      </div>

      {!account.deployed ? (
        <section className="section stack-16">
          <Notice>{t("walletPage.notCreated")}</Notice>
          <p className="muted">{t("create.wallet.explain1")}</p>
          <p className="muted">{t("create.wallet.explain2")}</p>
          <p className="small muted">{t("create.wallet.createHint")}</p>
          <div className="row-8">
            <button type="button" className="btn" onClick={createAccount} disabled={flow.status === "running"}>
              {t("create.wallet.create")}
            </button>
          </div>
          <dl className="dl dl-single">
            <DetailRow label={t("create.wallet.account")}>
              <AddressLink address={account.address} chainId={chainId} />
            </DetailRow>
          </dl>
          <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
        </section>
      ) : (
        <>
          {account.isLocked && current && (
            <section className="section">
              <Countdown target={current.end} now={now} />
              {isOwner && (
                <div className="actions-bar">
                  <div className="action-cell">
                    <button type="button" className="btn btn-lg" disabled>
                      {t("detail.unlockAtMaturity")}
                    </button>
                    <span className="small muted">{t("detail.unlockAtMaturityHint", { date: formatDate(current.end, locale) })}</span>
                  </div>
                  <div className="action-cell">
                    <button type="button" className="btn btn-secondary btn-lg" onClick={() => setEarlyOpen(true)}>
                      {t("detail.unlockEarly")}
                    </button>
                    <span className="small muted">
                      {t("detail.unlockEarlyHint", {
                        fee: formatBps(feeBpsAt(current.minFeeBps, current.maxFeeBps, current.start, current.end, now), locale),
                      })}
                    </span>
                  </div>
                </div>
              )}
            </section>
          )}

          {maturedPending && (
            <section className="section stack-16">
              <Notice tone="solid">{t("walletPage.completedNote")}</Notice>
              {isOwner && (
                <button type="button" className="btn btn-lg" onClick={completeLock} disabled={flow.status === "running"}>
                  {t("walletPage.completeLock")}
                </button>
              )}
            </section>
          )}

          {earlyDone && (
            <div className="section">
              <Notice tone="solid">{t("early.done")}</Notice>
            </div>
          )}

          {!account.isLocked && isOwner && (
            <section className="section row-8">
              <Link href="/create?type=wallet" className="btn btn-lg">
                {t("walletPage.lockNow")}
              </Link>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => setDepositOpen(true)}>
                {t("create.wallet.deposit")}
              </button>
            </section>
          )}

          <div style={{ marginTop: 16 }}>
            <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
          </div>

          <section className="section">
            <dl className="dl">
              <DetailRow label={t("common.lockAccount")}>
                <AddressLink address={account.address} chainId={chainId} />
              </DetailRow>
              <DetailRow label={t("detail.owner")}>{account.owner && <AddressLink address={account.owner} chainId={chainId} />}</DetailRow>
              <DetailRow label={t("detail.network")}>{chain?.name}</DetailRow>
              <DetailRow label={t("walletPage.lockStatus")}>
                {account.isLocked ? t("walletPage.lockedUntil", { date: formatDate(account.lockedUntil, locale) }) : t("status.unlocked")}
              </DetailRow>
              {account.isLocked && current && (
                <>
                  <DetailRow label={t("detail.created")}>{formatDate(current.start, locale)}</DetailRow>
                  <DetailRow label={t("detail.unlockDate")}>{formatDate(current.end, locale)}</DetailRow>
                  <DetailRow label={t("detail.totalDuration")}>{formatDurationLong(current.end - current.start, t)}</DetailRow>
                  <DetailRow label={t("detail.remaining")}>{formatDurationShort(current.end - now, t)}</DetailRow>
                  <DetailRow label={t("walletPage.stakingUsed")}>{current.staked ? t("common.yes") : t("common.no")}</DetailRow>
                  <DetailRow label={t("detail.feeTerms")}>
                    <span className="num">
                      {formatBps(current.maxFeeBps, locale)} → {formatBps(current.minFeeBps, locale)}
                    </span>
                  </DetailRow>
                </>
              )}
            </dl>
          </section>

          <section className="section">
            <SectionHead title={t("walletPage.assets")}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDepositOpen(true)}>
                {t("create.wallet.deposit")}
              </button>
            </SectionHead>
            {held.length === 0 ? (
              <p className="muted" style={{ paddingTop: 16 }}>
                {t("walletPage.noAssets")}
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("table.asset")}</th>
                    <th className="align-right">{t("table.balance")}</th>
                    <th className="align-right">{t("table.value")}</th>
                    <th className="align-right">{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {held.map((a) => {
                    const bal = balances?.[a.key] ?? 0n;
                    const value = usdValue(market, a, bal);
                    return (
                      <tr key={a.key}>
                        <td className="cell-primary">
                          <span className="asset-cell">
                            <TokenIcon symbol={a.symbol} />
                            <span>
                              <strong>{a.name}</strong>
                              <span className="asset-sub">{a.symbol}</span>
                            </span>
                          </span>
                        </td>
                        <td data-label={t("table.balance")} className="align-right num">
                          {formatAmount(bal, a.decimals, locale)}
                        </td>
                        <td data-label={t("table.value")} className="align-right num">
                          {value !== undefined ? formatUsd(value, locale) : t("common.none")}
                        </td>
                        <td data-label={t("table.actions")} className="align-right">
                          {a.kind === "vault" ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={account.isLocked || !isOwner || flow.status === "running"}
                              onClick={() => unstake(a)}
                            >
                              {t("walletPage.unstake")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={account.isLocked || !isOwner}
                              onClick={() => setWithdrawAsset(a)}
                            >
                              {t("walletPage.withdraw")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {account.isLocked && (
              <p className="small muted" style={{ marginTop: 12 }}>
                {t("walletPage.lockedNote")}
              </p>
            )}
          </section>

          <section className="section">
            <SectionHead title={t("walletPage.approvals")} />
            <ApprovalsList account={account} />
          </section>

          <RecoverySection account={account} isOwner={isOwner} />

          <p className="section">
            <Link href="/history" className="link">
              {t("walletPage.historyLink")}
            </Link>
          </p>

          <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} account={account.address} />
          {withdrawAsset && (
            <WithdrawModal asset={withdrawAsset} account={account} balance={balances?.[withdrawAsset.key] ?? 0n} onClose={() => setWithdrawAsset(null)} />
          )}
          {account.isLocked && current && (
            <WalletEarlyUnlockModal
              open={earlyOpen}
              onClose={() => setEarlyOpen(false)}
              account={account}
              lock={current}
              refresh={() => void query.refetch()}
              onDone={() => {
                setEarlyOpen(false);
                setEarlyDone(true);
              }}
            />
          )}
        </>
      )}
    </>
  );
}

function WithdrawModal({
  asset,
  account,
  balance,
  onClose,
}: {
  asset: Asset;
  account: LockAccountState;
  balance: bigint;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { address, chainId } = useNetwork();
  const flow = useTxFlow();
  const [input, setInput] = useState("");
  const amount = parseAmount(input, asset.decimals);
  const tooHigh = amount !== null && amount > balance;
  const busy = flow.status === "running";

  const submit = () =>
    flow.run([
      {
        id: "withdraw",
        label: `${t("walletPage.withdraw")} ${asset.symbol}`,
        send: async () => {
          const owner = address as Address;
          const args =
            asset.kind === "native"
              ? ([owner, amount!, "0x"] as const)
              : ([asset.address, 0n, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner, amount!] })] as const);
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "execute",
            args,
            account: owner,
          });
          return writeContract(config, request);
        },
      },
    ]);

  return (
    <Modal
      open
      title={t("walletPage.withdrawTitle")}
      onClose={onClose}
      locked={busy}
      footer={
        flow.status === "success" ? (
          <button type="button" className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn" onClick={submit} disabled={busy || !amount || amount === 0n || tooHigh}>
              {t("walletPage.withdraw")}
            </button>
          </>
        )
      }
    >
      <div className="stack-16">
        <div className="input-wrap">
          <input className="input" inputMode="decimal" placeholder="0.0" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
          <span className="input-suffix">{asset.symbol}</span>
        </div>
        <div className="row-8 small muted">
          <span>{t("create.amount.available", { amount: `${formatAmount(balance, asset.decimals, locale)} ${asset.symbol}` })}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setInput(formatAmount(balance, asset.decimals, "en-US", asset.decimals).replace(/,/g, ""))}
          >
            {t("common.max")}
          </button>
        </div>
        {address && (
          <p className="small muted">
            → <AddressLink address={address} chainId={chainId} />
          </p>
        )}
        {tooHigh && <p className="error-text">{t("create.amount.tooHigh")}</p>}
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </Modal>
  );
}

function RecoverySection({ account, isOwner }: { account: LockAccountState; isOwner: boolean }) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { address, chainId } = useNetwork();
  const flow = useTxFlow();
  const [recovery, setRecovery] = useState("");
  const [days, setDays] = useState("7");
  const { recovery: current } = account;
  const daysNumber = Number(days);
  const validDays = Number.isInteger(daysNumber) && daysNumber >= 2 && daysNumber <= 90;
  const validAddress = isAddress(recovery);
  const editable = isOwner && !account.isLocked;

  const saveRecovery = (id: string, label: string, recoveryAddress: Address, delaySeconds: bigint) =>
    flow.run([
      {
        id,
        label,
        send: async () => {
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "setRecovery",
            args: [recoveryAddress, delaySeconds],
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);

  const cancelRecovery = () =>
    flow.run([
      {
        id: "cancel-recovery",
        label: t("walletPage.recoveryCancel"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "cancelRecovery",
            account: address,
          });
          return writeContract(config, request);
        },
      },
    ]);

  return (
    <section className="section">
      <SectionHead title={t("walletPage.recovery")} />
      <div className="stack-16" style={{ paddingTop: 16 }}>
        <p className="muted">{t("walletPage.recoveryLead")}</p>
        <dl className="dl dl-single">
          <DetailRow label={t("walletPage.recoveryAddress")}>
            {current.address ? (
              <span>
                <AddressLink address={current.address} chainId={chainId} /> · {formatDurationLong(current.delay, t)}
              </span>
            ) : (
              t("walletPage.recoveryNone")
            )}
          </DetailRow>
        </dl>
        {current.pendingOwner && (
          <Notice tone="solid">
            <p>{t("walletPage.recoveryPending", { address: current.pendingOwner, date: formatDate(current.executableAt, locale) })}</p>
            {isOwner && (
              <button type="button" className="btn btn-inverse btn-sm" onClick={cancelRecovery}>
                {t("walletPage.recoveryCancel")}
              </button>
            )}
          </Notice>
        )}
        {editable ? (
          <div className="stack-16">
            <label className="field">
              <span className="field-label eyebrow">{t("walletPage.recoveryAddress")}</span>
              <input className="input mono" placeholder="0x…" value={recovery} onChange={(e) => setRecovery(e.target.value.trim())} />
            </label>
            {recovery !== "" && !validAddress && <p className="error-text">{t("error.invalidAddress")}</p>}
            <label className="field" style={{ maxWidth: 200 }}>
              <span className="field-label eyebrow">{t("walletPage.recoveryDelay")}</span>
              <input className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            {!validDays && <p className="error-text">{t("error.InvalidRecoveryDelay")}</p>}
            <div className="row-8">
              <button
                type="button"
                className="btn"
                disabled={!validAddress || !validDays || flow.status === "running"}
                onClick={() =>
                  saveRecovery("set-recovery", t("walletPage.recoverySave"), recovery as Address, BigInt(daysNumber * 86_400))
                }
              >
                {t("walletPage.recoverySave")}
              </button>
              {current.address && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={flow.status === "running"}
                  onClick={() =>
                    saveRecovery("disable-recovery", t("walletPage.recoveryDisable"), "0x0000000000000000000000000000000000000000", 0n)
                  }
                >
                  {t("walletPage.recoveryDisable")}
                </button>
              )}
            </div>
          </div>
        ) : (
          account.isLocked && <p className="small muted">{t("walletPage.lockedNote")}</p>
        )}
        <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
      </div>
    </section>
  );
}
