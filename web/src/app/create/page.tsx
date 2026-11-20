"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConfig, useEstimateFeesPerGas } from "wagmi";
import { readContract, simulateContract, writeContract } from "wagmi/actions";
import { type Address, erc20Abi, erc721Abi, isAddress, parseEventLogs, zeroAddress } from "viem";
import { lockVaultAbi, lockableAccountAbi, lockableAccountFactoryAbi, nftLockVaultAbi } from "@/generated/abis";
import { RequireReady } from "@/components/RequireReady";
import { ApprovalsList } from "@/components/ApprovalsList";
import { DepositModal } from "@/components/DepositModal";
import { IconArrowLeft, IconArrowRight, IconCheck, IconSearch } from "@/components/Icons";
import { NftImage, NftPicture, useNftLabel } from "@/components/NftImage";
import { TokenIcon, WalletIcon } from "@/components/TokenIcon";
import { AddressLink, Countdown, DetailRow, Notice, TxProgress } from "@/components/ui";
import {
  type Market,
  type Terms,
  readTokenMetadata,
  useAssets,
  useBalances,
  useLockAccount,
  useMarket,
  useReadyClient,
  useTerms,
  useVaultApy,
  usdValue,
} from "@/hooks/protocol";
import {
  type InspectResult,
  type NftRef,
  type NftTerms,
  type OwnedNft,
  STANDARD_INDEX,
  erc1155Abi,
  inspectNft,
  useNftMetadata,
  useNftTerms,
  useOwnedNfts,
} from "@/hooks/nft";
import { useNetwork } from "@/hooks/useNetwork";
import { type TxStep, useTxFlow } from "@/hooks/useTxFlow";
import { LOCAL_CHAIN_ID } from "@/config/chains";
import { type Asset, isNativeMirror } from "@/lib/assets";
import { useChainNow } from "@/lib/chainClock";
import { usePreferences } from "@/lib/preferences";
import { useCustomTokens } from "@/lib/customTokens";
import { feeBpsAfterShare } from "@/lib/fees";
import { formatAmount, formatBps, formatDate, formatUsd, parseAmount, shortAddress, toFloat } from "@/lib/format";
import { formatDurationLong, useI18n } from "@/lib/i18n";

const PRESETS = [7, 14, 30, 90, 180, 365] as const;
type Preset = (typeof PRESETS)[number] | "custom";
type LockType = "crypto" | "nft" | "wallet";

interface SelectedNft {
  ref: NftRef;
  balance: bigint;
  collectionName: string;
}

export default function CreatePage() {
  return (
    <div className="container page">
      <RequireReady>
        <Suspense fallback={null}>
          <Wizard />
        </Suspense>
      </RequireReady>
    </div>
  );
}

function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Wizard() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const config = useConfig();
  const now = useChainNow();
  const nowRef = useRef(now);
  nowRef.current = now;

  const { address, deployment, chain, chainId } = useNetwork();
  const termsQuery = useTerms();
  const liveTerms = termsQuery.data;
  const market = useMarket().data;
  const balances = useBalances(address);
  const accountQuery = useLockAccount(address);
  const account = accountQuery.data;
  const accountBalances = useBalances(account?.deployed ? account.address : undefined).data;
  const fees = useEstimateFeesPerGas();
  const flow = useTxFlow();

  const [step, setStep] = useState(0);
  const [type, setType] = useState<LockType | null>(null);
  const [assetKey, setAssetKey] = useState<string | null>(null);
  const [amountMode, setAmountMode] = useState<"all" | "custom">("all");
  const [amountInput, setAmountInput] = useState("");
  const [stake, setStake] = useState<boolean | null>(null);
  const [walletStakes, setWalletStakes] = useState<Record<string, boolean>>({});
  const [preset, setPreset] = useState<Preset | null>(null);
  const [customUnlock, setCustomUnlock] = useState("");
  const [ack, setAck] = useState(false);
  const [created, setCreated] = useState<{ kind: LockType; id?: bigint } | null>(null);
  const [nft, setNft] = useState<SelectedNft | null>(null);
  const [nftAmountInput, setNftAmountInput] = useState("1");
  const nftTermsQuery = useNftTerms();
  const liveNftTerms = nftTermsQuery.data;
  const nftVault = deployment?.contracts.nftLockVault;
  const [reviewed, setReviewed] = useState<{ terms: Terms; nftTerms?: NftTerms } | null>(null);
  const terms = step === 4 && reviewed ? reviewed.terms : liveTerms;
  const nftTerms = step === 4 && reviewed?.nftTerms ? reviewed.nftTerms : liveNftTerms;

  useEffect(() => {
    const requested = params.get("type");
    if (requested === "wallet" || requested === "crypto" || requested === "nft") {
      setType(requested);
      setStep(1);
    }
  }, [params]);

  const { assets } = useAssets();
  const asset = assets.find((a) => a.key === assetKey);

  useEffect(() => {
    if (step !== 4) {
      setReviewed(null);
      return;
    }
    if (!reviewed && liveTerms && (type !== "nft" || liveNftTerms)) {
      setReviewed({ terms: liveTerms, nftTerms: type === "nft" ? liveNftTerms : undefined });
    }
  }, [step, reviewed, liveTerms, liveNftTerms, type]);

  const nftAmount = !nft
    ? 0n
    : nft.ref.standard === "erc721"
      ? 1n
      : /^\d{1,30}$/.test(nftAmountInput.trim())
        ? BigInt(nftAmountInput.trim())
        : 0n;
  const nftAmountOk = !!nft && nftAmount >= 1n && nftAmount <= nft.balance;
  const balance = asset ? (balances.data?.[asset.key] ?? 0n) : 0n;

  const perGas = fees.data?.maxFeePerGas ?? fees.data?.gasPrice;
  const gasReserve = perGas ? perGas * 600_000n : 3n * 10n ** 15n;
  const maxLockable = asset?.kind === "native" ? (balance > gasReserve ? balance - gasReserve : 0n) : balance;
  const amount = amountMode === "all" ? maxLockable : asset ? parseAmount(amountInput, asset.decimals) : null;
  const amountError =
    amountMode === "custom" && amountInput !== "" && (amount === null || amount === 0n)
      ? "invalid"
      : amount !== null && amount > maxLockable
        ? "tooHigh"
        : null;

  const cryptoVault = asset ? terms?.stakingVaults[asset.key] : undefined;
  const stakingComingSoon = !!terms && !Object.values(terms.stakingVaults).some(Boolean);
  useEffect(() => {
    if (step === 2 && type === "crypto" && terms && !cryptoVault) setStake(false);
  }, [step, type, terms, cryptoVault]);

  const eligibleWalletAssets = assets.filter(
    (a) => a.kind !== "vault" && terms?.stakingVaults[a.key] && (accountBalances?.[a.key] ?? 0n) > 0n,
  );

  const termsChanged = (() => {
    if (step !== 4 || !reviewed) return false;
    if (type === "nft") {
      const before = reviewed.nftTerms;
      return !!before && !!liveNftTerms && (liveNftTerms.minFee !== before.minFee || liveNftTerms.maxFee !== before.maxFee);
    }
    if (!liveTerms) return false;
    const before = reviewed.terms;
    if (liveTerms.minFeeBps !== before.minFeeBps || liveTerms.maxFeeBps !== before.maxFeeBps) return true;
    const vaultChanged = (key: string) => liveTerms.stakingVaults[key] !== before.stakingVaults[key];
    if (type === "wallet") {
      return (
        liveTerms.feeAssetListVersion !== before.feeAssetListVersion ||
        eligibleWalletAssets.some((a) => walletStakes[a.key] && vaultChanged(a.key))
      );
    }
    return type === "crypto" && stake === true && !!asset && vaultChanged(asset.key);
  })();
  const reviewAgain = () => {
    setAck(false);
    setReviewed(null);
    flow.reset();
  };

  const unlockTime = useMemo(() => {
    if (preset === null) return null;
    if (preset === "custom") {
      const ms = Date.parse(customUnlock);
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
    return now + preset * 86_400;
  }, [preset, customUnlock, now]);
  const duration = unlockTime !== null ? unlockTime - now : 0;
  const durationOk =
    unlockTime !== null && !!terms && duration >= terms.minDuration && duration <= terms.maxDuration;

  const hasLiveApprovals = !!account?.approvals.some((a) => a.live);
  const canContinue = [
    type !== null,
    type === "crypto"
      ? !!asset && amount !== null && amount > 0n && !amountError
      : type === "nft"
        ? !!nftVault && nftAmountOk
        : !!account?.deployed && !account.isLocked && !hasLiveApprovals,
    type === "crypto" ? stake !== null : true,
    durationOk,
    ack && durationOk && !!reviewed && !termsChanged && (type !== "nft" || !!nftTerms),
  ][step];

  const busy = flow.status === "running";

  const confirm = async () => {
    if (!address || !deployment || !terms || unlockTime === null) return;
    const unlockAt = () =>
      preset === "custom"
        ? unlockTime
        : Math.max(Math.floor(Date.now() / 1000), nowRef.current) + (preset as number) * 86_400;
    const steps: TxStep[] = [];

    if (type === "crypto" && asset && amount) {
      const vault = deployment.contracts.lockVault;
      if (asset.kind !== "native") {
        let allowance = 0n;
        try {
          allowance = await readContract(config, {
            address: asset.address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, vault],
          });
        } catch {
          allowance = 0n;
        }
        const approve = (value: bigint, id: string): TxStep => ({
          id,
          label: t("create.tx.approve", { symbol: asset.symbol }),
          send: async () => {
            const { request } = await simulateContract(config, {
              address: asset.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [vault, value],
              account: address,
            });
            return writeContract(config, request);
          },
        });
        if (allowance < amount) {
          if (allowance > 0n) steps.push(approve(0n, "approve-reset"));
          steps.push(approve(amount, "approve"));
        }
      }
      steps.push({
        id: "lock",
        label: t("create.tx.lock", { symbol: asset.symbol }),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: vault,
            abi: lockVaultAbi,
            functionName: "lock",
            args: [
              asset.address,
              amount,
              BigInt(unlockAt()),
              stake === true && cryptoVault ? cryptoVault : zeroAddress,
              terms.minFeeBps,
              terms.maxFeeBps,
            ],
            value: asset.kind === "native" ? amount : 0n,
            account: address,
          });
          return writeContract(config, request);
        },
      });
      const receipts = await flow.run(steps);
      if (receipts) {
        const events = parseEventLogs({ abi: lockVaultAbi, eventName: "Locked", logs: receipts[receipts.length - 1].logs });
        setCreated({ kind: "crypto", id: events[0]?.args.lockId });
      } else {
        void termsQuery.refetch();
      }
      return;
    }

    if (type === "nft" && nft && nftVault && nftTerms) {
      const { collection, standard, tokenId } = nft.ref;
      let approved = false;
      try {
        if (standard === "erc721") {
          const [single, all] = await Promise.all([
            readContract(config, { address: collection, abi: erc721Abi, functionName: "getApproved", args: [tokenId] }),
            readContract(config, { address: collection, abi: erc721Abi, functionName: "isApprovedForAll", args: [address, nftVault] }),
          ]);
          approved = single.toLowerCase() === nftVault.toLowerCase() || all;
        } else {
          approved = await readContract(config, {
            address: collection,
            abi: erc1155Abi,
            functionName: "isApprovedForAll",
            args: [address, nftVault],
          });
        }
      } catch {
        approved = false;
      }
      if (!approved) {
        steps.push({
          id: "approve-nft",
          label: t("create.tx.approveNft"),
          send: async () => {
            if (standard === "erc721") {
              const { request } = await simulateContract(config, {
                address: collection,
                abi: erc721Abi,
                functionName: "approve",
                args: [nftVault, tokenId],
                account: address,
              });
              return writeContract(config, request);
            }
            const { request } = await simulateContract(config, {
              address: collection,
              abi: erc1155Abi,
              functionName: "setApprovalForAll",
              args: [nftVault, true],
              account: address,
            });
            return writeContract(config, request);
          },
        });
      }
      steps.push({
        id: "lock-nft",
        label: t("create.tx.lockNft"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: nftVault,
            abi: nftLockVaultAbi,
            functionName: "lock",
            args: [collection, STANDARD_INDEX[standard], tokenId, nftAmount, BigInt(unlockAt()), nftTerms.minFee, nftTerms.maxFee],
            account: address,
          });
          return writeContract(config, request);
        },
      });
      const receipts = await flow.run(steps);
      if (receipts) {
        const events = parseEventLogs({ abi: nftLockVaultAbi, eventName: "NftLocked", logs: receipts[receipts.length - 1].logs });
        setCreated({ kind: "nft", id: events[0]?.args.lockId });
      } else {
        void nftTermsQuery.refetch();
      }
      return;
    }

    if (type === "wallet" && account?.deployed) {
      const stakes = eligibleWalletAssets
        .filter((a) => walletStakes[a.key])
        .map((a) => ({ token: a.address, vault: terms.stakingVaults[a.key] as Address, amount: accountBalances?.[a.key] ?? 0n }))
        .filter((s) => s.amount > 0n);
      steps.push({
        id: "lock-wallet",
        label: t("create.tx.lockWallet"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: account.address,
            abi: lockableAccountAbi,
            functionName: "lock",
            args: [BigInt(unlockAt()), stakes, terms.minFeeBps, terms.maxFeeBps, terms.feeAssetListVersion],
            account: address,
          });
          return writeContract(config, request);
        },
      });
      const receipts = await flow.run(steps);
      if (receipts) setCreated({ kind: "wallet" });
      else void termsQuery.refetch();
    }
  };

  if (created) {
    return (
      <div className="gate fade-in">
        <span className="chip chip-solid">
          <IconCheck size={14} /> {t("tx.done")}
        </span>
        <h1 className="h2">{t("create.done.title")}</h1>
        <p className="muted">{t("create.done.body")}</p>
        <div className="row-8">
          {created.kind === "crypto" && created.id !== undefined ? (
            <Link href={`/locks/${created.id}`} className="btn">
              {t("create.done.view")}
            </Link>
          ) : created.kind === "nft" && created.id !== undefined ? (
            <Link href={`/nft-locks/${created.id}`} className="btn">
              {t("create.done.view")}
            </Link>
          ) : (
            <Link href="/wallet" className="btn">
              {t("create.done.view")}
            </Link>
          )}
          <Link href="/" className="btn btn-secondary">
            {t("create.done.dashboard")}
          </Link>
        </div>
      </div>
    );
  }

  const stepLabels = [
    t("create.step.type"),
    t("create.step.asset"),
    t("create.step.staking"),
    t("create.step.duration"),
    t("create.step.review"),
  ];

  return (
    <>
      <div className="page-head">
        <h1 className="h2">{t("create.title")}</h1>
      </div>
      <ol className="stepper" aria-label={t("create.title")}>
        {stepLabels.map((label, i) => (
          <li key={label} className="step" data-state={i < step ? "done" : i === step ? "current" : "upcoming"}>
            <span className="step-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>

      <div key={step} className="fade-in">
        {step === 0 && (
          <StepType
            type={type}
            onSelect={(value) => {
              setType(value);
              setStake(null);
              setStep(1);
            }}
          />
        )}

        {step === 1 && type === "crypto" && (
          <StepCryptoAsset
            assets={assets.filter((a) => a.kind !== "vault")}
            balances={balances.data}
            market={market}
            networkName={chain?.name ?? ""}
            selected={assetKey}
            onSelect={(key) => {
              setAssetKey(key);
              setAmountMode("all");
              setAmountInput("");
              setStake(null);
            }}
            amountMode={amountMode}
            setAmountMode={setAmountMode}
            amountInput={amountInput}
            setAmountInput={setAmountInput}
            maxLockable={maxLockable}
            gasReserve={asset?.kind === "native" ? gasReserve : 0n}
            amountError={amountError}
          />
        )}

        {step === 1 && type === "nft" && (
          <StepNftAsset
            owner={address!}
            networkName={chain?.name ?? ""}
            available={!!nftVault}
            selected={nft}
            onSelect={(value) => {
              setNft(value);
              setNftAmountInput("1");
            }}
            amountInput={nftAmountInput}
            setAmountInput={setNftAmountInput}
            amountOk={nftAmountOk}
          />
        )}

        {step === 2 && type === "nft" && (
          <section className="stack-24">
            <h2 className="h2">{t("create.staking.title")}</h2>
            <Notice>{t("create.staking.unavailableNft")}</Notice>
            <div className="grid-lines choice-grid">
              <button type="button" className="choice" disabled>
                <span className="choice-title">{t("create.staking.yes")}</span>
              </button>
              <button type="button" className="choice" aria-pressed>
                <span className="choice-title">{t("create.staking.no")}</span>
                <p className="muted">{t("create.staking.noBody")}</p>
              </button>
            </div>
          </section>
        )}

        {step === 1 && type === "wallet" && (
          <StepWallet
            owner={address!}
            account={account}
            loading={accountQuery.isLoading}
            assets={assets}
            balances={accountBalances}
            market={market}
          />
        )}

        {step === 2 && type === "crypto" && asset && (
          <StepCryptoStaking
            asset={asset}
            vault={cryptoVault}
            assets={assets}
            amount={amount ?? 0n}
            stake={stake}
            setStake={setStake}
            comingSoon={stakingComingSoon}
            networkName={chain?.name ?? ""}
            chainId={chainId}
          />
        )}

        {step === 2 && type === "wallet" && (
          <StepWalletStaking
            eligible={eligibleWalletAssets}
            assets={assets}
            terms={terms}
            balances={accountBalances}
            selected={walletStakes}
            setSelected={setWalletStakes}
            comingSoon={stakingComingSoon}
            networkName={chain?.name ?? ""}
            chainId={chainId}
          />
        )}

        {step === 3 && (
          <StepDuration
            terms={terms}
            preset={preset}
            setPreset={setPreset}
            customUnlock={customUnlock}
            setCustomUnlock={setCustomUnlock}
            unlockTime={unlockTime}
            durationOk={durationOk}
            now={now}
          />
        )}

        {step === 4 && terms && unlockTime !== null && (
          <section className="stack-24">
            <h2 className="h2">{t("create.review.title")}</h2>
            <dl className="dl">
              <DetailRow label={t("create.review.type")}>
                {type === "crypto" ? t("type.crypto") : type === "nft" ? t("type.nft") : t("type.wallet")}
              </DetailRow>
              {type === "nft" && nft ? (
                <>
                  <DetailRow label={t("create.review.nft")}>
                    <NftReviewLabel nft={nft} />
                  </DetailRow>
                  <DetailRow label={t("create.review.amount")}>
                    {nft.ref.standard === "erc1155" ? t("history.nftUnits", { n: nftAmount.toString() }) : t("history.oneNft")}
                  </DetailRow>
                  <DetailRow label={t("create.review.staking")}>{t("detail.stakingNa")}</DetailRow>
                </>
              ) : type === "crypto" && asset ? (
                <>
                  <DetailRow label={t("create.review.asset")}>
                    {asset.name} ({asset.symbol})
                  </DetailRow>
                  <DetailRow label={t("create.review.amount")}>
                    <span className="num">
                      {formatAmount(amount ?? 0n, asset.decimals, locale)} {asset.symbol}
                      {(() => {
                        const v = usdValue(market, asset, amount ?? 0n);
                        return v !== undefined ? ` · ${formatUsd(v, locale)}` : "";
                      })()}
                    </span>
                  </DetailRow>
                  <DetailRow label={t("create.review.staking")}>
                    {stake && cryptoVault ? t("create.review.stakingOn") : t("create.review.stakingOff")}
                  </DetailRow>
                </>
              ) : (
                <>
                  <DetailRow label={t("common.lockAccount")}>
                    {account && <AddressLink address={account.address} chainId={chainId} />}
                  </DetailRow>
                  <DetailRow label={t("create.review.amount")}>{t("common.allAssets")}</DetailRow>
                  <DetailRow label={t("create.review.staking")}>
                    {eligibleWalletAssets.some((a) => walletStakes[a.key])
                      ? `${t("create.review.stakingOn")} · ${eligibleWalletAssets
                          .filter((a) => walletStakes[a.key])
                          .map((a) => a.symbol)
                          .join(", ")}`
                      : t("create.review.stakingOff")}
                  </DetailRow>
                </>
              )}
              <DetailRow label={t("create.review.duration")}>{formatDurationLong(duration, t)}</DetailRow>
              <DetailRow label={t("create.review.unlockDate")}>{formatDate(unlockTime, locale)}</DetailRow>
            </dl>

            {type === "nft" ? (
              nftTerms && (
                <NftEarlyUnlockTerms
                  minFee={nftTerms.minFee}
                  maxFee={nftTerms.maxFee}
                  symbol={deployment!.native.symbol}
                  decimals={deployment!.native.decimals}
                />
              )
            ) : (
              <EarlyUnlockTerms terms={terms} isWallet={type === "wallet"} />
            )}

            <Notice tone="solid">
              <p>{t("create.duration.warning")}</p>
            </Notice>

            {termsChanged && (
              <div role="alert">
                <Notice tone="solid">
                  <p>{t("create.review.termsChanged")}</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={reviewAgain} disabled={busy}>
                    {t("create.review.showNewTerms")}
                  </button>
                </Notice>
              </div>
            )}

            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              <span>{t("create.review.ack", { date: formatDate(unlockTime, locale) })}</span>
            </label>
            <p className="small muted">{t("create.review.networkFee", { symbol: deployment!.native.symbol })}</p>
            <TxProgress steps={flow.steps} error={flow.error} chainId={chainId} />
          </section>
        )}
      </div>

      {step > 0 && (
        <div className="wizard-foot">
          <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>
            <IconArrowLeft /> {t("common.back")}
          </button>
          {step < 4 ? (
            <button type="button" className="btn" onClick={() => setStep(step + 1)} disabled={!canContinue}>
              {t("common.continue")} <IconArrowRight />
            </button>
          ) : (
            <button type="button" className="btn btn-lg" onClick={confirm} disabled={!canContinue || busy}>
              {flow.status === "error" ? t("common.retry") : t("create.review.confirm")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

const TYPE_COPY = {
  crypto: { title: "create.type.crypto.title", body: "create.type.crypto.body" },
  nft: { title: "create.type.nft.title", body: "create.type.nft.body" },
  wallet: { title: "create.type.wallet.title", body: "create.type.wallet.body" },
} as const;

function StepType({ type, onSelect }: { type: LockType | null; onSelect: (type: LockType) => void }) {
  const { t } = useI18n();
  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.type.title")}</h2>
      <div className="grid-lines choice-grid choice-grid-3">
        {(["crypto", "nft", "wallet"] as const).map((value, i) => (
          <button key={value} type="button" className="choice" aria-pressed={type === value} onClick={() => onSelect(value)}>
            <span className="choice-index">0{i + 1}</span>
            {value === "crypto" ? (
              <TokenIcon symbol="ETH" size={36} />
            ) : value === "nft" ? (
              <NftPicture size={36} />
            ) : (
              <WalletIcon size={36} />
            )}
            <span className="choice-title">{t(TYPE_COPY[value].title)}</span>
            <p className="muted">{t(TYPE_COPY[value].body)}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function NftCard({ nft, selected, onSelect }: { nft: OwnedNft; selected: boolean; onSelect: () => void }) {
  const metadata = useNftMetadata(nft).data;
  const name = metadata?.name || `${nft.collectionName} #${nft.tokenId}`;
  return (
    <button type="button" className="nft-card" aria-pressed={selected} onClick={onSelect}>
      <NftPicture image={metadata?.image} fill />
      <span>
        <strong>{name}</strong>
        <span className="muted small" style={{ display: "block" }}>
          {nft.collectionName}
          {nft.standard === "erc1155" && ` · ×${nft.balance.toString()}`}
        </span>
      </span>
    </button>
  );
}

function NftReviewLabel({ nft }: { nft: SelectedNft }) {
  const label = useNftLabel(nft.ref, nft.collectionName);
  return (
    <span className="row-8" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
      <NftImage nft={nft.ref} size={28} />
      {label}
    </span>
  );
}

function SelectedNftSummary({ nft }: { nft: SelectedNft }) {
  const { t } = useI18n();
  const label = useNftLabel(nft.ref, nft.collectionName);
  return (
    <div className="row-8" style={{ flexWrap: "nowrap", gap: 16 }}>
      <NftImage nft={nft.ref} size={72} />
      <div>
        <strong>{label}</strong>
        <div className="muted small">
          {nft.collectionName || shortAddress(nft.ref.collection)} · {nft.ref.standard.toUpperCase().replace("ERC", "ERC-")} ·{" "}
          {nft.ref.standard === "erc1155" ? t("create.nft.balance", { n: nft.balance.toString() }) : t("create.nft.owns")}
        </div>
      </div>
    </div>
  );
}

function StepNftAsset(props: {
  owner: Address;
  networkName: string;
  available: boolean;
  selected: SelectedNft | null;
  onSelect: (nft: SelectedNft) => void;
  amountInput: string;
  setAmountInput: (value: string) => void;
  amountOk: boolean;
}) {
  const { t } = useI18n();
  const { client } = useReadyClient();
  const owned = useOwnedNfts(props.owner);
  const [collectionInput, setCollectionInput] = useState("");
  const [tokenIdInput, setTokenIdInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<(InspectResult & { ref?: NftRef }) | null>(null);
  const isSelected = (ref: NftRef) =>
    !!props.selected &&
    props.selected.ref.collection.toLowerCase() === ref.collection.toLowerCase() &&
    props.selected.ref.tokenId === ref.tokenId;

  const check = async () => {
    if (!client || !isAddress(collectionInput) || !/^\d{1,78}$/.test(tokenIdInput)) return;
    setChecking(true);
    setChecked(null);
    try {
      const tokenId = BigInt(tokenIdInput);
      const result = await inspectNft(client, collectionInput, tokenId, props.owner);
      setChecked(result.ok ? { ...result, ref: { collection: collectionInput, standard: result.standard, tokenId } } : result);
    } finally {
      setChecking(false);
    }
  };

  if (!props.available) {
    return (
      <section className="stack-24">
        <h2 className="h2">{t("create.nft.title")}</h2>
        <Notice>{t("create.nft.unavailable", { network: props.networkName })}</Notice>
      </section>
    );
  }

  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.nft.title")}</h2>

      <div>
        <div className="section-head">
          <h3>{t("create.nft.owned")}</h3>
        </div>
        <div style={{ paddingTop: 16 }}>
          {owned.data && owned.data.length > 0 ? (
            <div className="nft-grid">
              {owned.data.map((n) => (
                <NftCard
                  key={`${n.collection}-${n.tokenId}`}
                  nft={n}
                  selected={isSelected(n)}
                  onSelect={() => props.onSelect({ ref: n, balance: n.balance, collectionName: n.collectionName })}
                />
              ))}
            </div>
          ) : (
            <p className="muted">{owned.isLoading ? t("common.loading") : t("create.nft.noneOwned")}</p>
          )}
        </div>
      </div>

      <div className="panel stack-16">
        <h3>{t("create.nft.manualTitle")}</h3>
        <div className="nft-manual">
          <label className="field">
            <span className="field-label eyebrow">{t("create.nft.collection")}</span>
            <input className="input mono" placeholder="0x…" value={collectionInput} onChange={(e) => setCollectionInput(e.target.value.trim())} />
          </label>
          <label className="field">
            <span className="field-label eyebrow">{t("create.nft.tokenId")}</span>
            <input className="input" inputMode="numeric" placeholder="1" value={tokenIdInput} onChange={(e) => setTokenIdInput(e.target.value.trim())} />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={check}
            disabled={checking || !isAddress(collectionInput) || !/^\d{1,78}$/.test(tokenIdInput)}
          >
            {checking ? t("create.nft.checking") : t("create.nft.check")}
          </button>
        </div>
        {checked && !checked.ok && <p className="error-text">{t("create.nft.notNft", { network: props.networkName })}</p>}
        {checked?.ok && checked.balance === 0n && <p className="error-text">{t("create.nft.notOwner")}</p>}
        {checked?.ok && checked.balance > 0n && checked.ref && (
          <div className="row-8" style={{ justifyContent: "space-between" }}>
            <span className="row-8">
              <NftImage nft={checked.ref} size={44} />
              <span>
                <strong>
                  {checked.collectionName || shortAddress(checked.ref.collection)} #{checked.ref.tokenId.toString()}
                </strong>
                <span className="muted small" style={{ display: "block" }}>
                  {checked.standard.toUpperCase().replace("ERC", "ERC-")} ·{" "}
                  {checked.standard === "erc1155" ? t("create.nft.balance", { n: checked.balance.toString() }) : t("create.nft.owns")}
                </span>
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                props.onSelect({ ref: checked.ref!, balance: checked.balance, collectionName: checked.collectionName })
              }
            >
              {t("create.nft.use")}
            </button>
          </div>
        )}
      </div>

      {props.selected && (
        <div className="panel stack-16 fade-in">
          <h3>{t("create.nft.selected")}</h3>
          <SelectedNftSummary nft={props.selected} />
          {props.selected.ref.standard === "erc1155" && (
            <label className="field" style={{ maxWidth: 240 }}>
              <span className="field-label eyebrow">{t("create.nft.amount")}</span>
              <input
                className="input"
                inputMode="numeric"
                aria-label={t("create.nft.amount")}
                value={props.amountInput}
                onChange={(e) => props.setAmountInput(e.target.value)}
              />
            </label>
          )}
          {!props.amountOk && (
            <p className="error-text">{t("create.nft.amountInvalid", { max: props.selected.balance.toString() })}</p>
          )}
        </div>
      )}
      <p className="small muted">{t("create.nft.metadataNote")}</p>
    </section>
  );
}

function NftEarlyUnlockTerms({ minFee, maxFee, symbol, decimals }: { minFee: bigint; maxFee: bigint; symbol: string; decimals: number }) {
  const { t, locale } = useI18n();
  const fmt = (v: bigint) => `${formatAmount(v, decimals, locale, 6)} ${symbol}`;
  const points = [0, 0.25, 0.5, 0.75, 0.99];
  return (
    <div className="panel stack-16">
      <h3>{t("create.review.earlyTitle")}</h3>
      <p>{t("create.review.nftEarlyBody", { symbol, min: fmt(minFee), max: fmt(maxFee) })}</p>
      <div className="formula">{t("create.review.nftFormula", { min: fmt(minFee), max: fmt(maxFee) })}</div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {t("create.review.schedule")}
        </div>
        <div className="grid-lines schedule">
          {points.map((p) => {
            const remaining = BigInt(Math.round((1 - p) * 10_000));
            const fee = minFee + ((maxFee - minFee) * remaining) / 10_000n;
            return (
              <div key={p}>
                <div className="small muted">{t("create.review.elapsed", { pct: Math.round(p * 100) })}</div>
                <div className="num" style={{ fontWeight: 600, marginTop: 4 }}>
                  {fmt(fee)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddTokenForm({ networkName, onAdded }: { networkName: string; onAdded: (key: string) => void }) {
  const { t } = useI18n();
  const { client, chainId } = useReadyClient();
  const { add } = useCustomTokens(chainId);
  const [value, setValue] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "error" | "nativeMirror" } | { kind: "added"; symbol: string }>({
    kind: "idle",
  });

  const submit = async () => {
    if (!client || !isAddress(value)) return;
    if (isNativeMirror(value)) {
      setState({ kind: "nativeMirror" });
      return;
    }
    setState({ kind: "busy" });
    const metadata = await readTokenMetadata(client, value);
    if (!metadata) {
      setState({ kind: "error" });
      return;
    }
    add(metadata);
    setState({ kind: "added", symbol: metadata.symbol });
    setValue("");
    onAdded(value.toLowerCase());
  };

  return (
    <div className="panel stack-8">
      <h3>{t("create.asset.addToken")}</h3>
      <p className="small muted">{t("create.asset.addTokenHint")}</p>
      <div className="row-8" style={{ flexWrap: "nowrap" }}>
        <input
          className="input mono"
          placeholder={t("create.asset.addTokenPlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          aria-label={t("create.asset.addToken")}
        />
        <button type="button" className="btn btn-secondary" onClick={submit} disabled={!isAddress(value) || state.kind === "busy"}>
          {t("create.asset.addTokenButton")}
        </button>
      </div>
      {state.kind === "error" && <p className="error-text">{t("create.asset.addTokenInvalid", { network: networkName })}</p>}
      {state.kind === "nativeMirror" && <p className="error-text">{t("create.asset.nativeMirror")}</p>}
      {state.kind === "added" && <p className="small">{t("create.asset.addTokenAdded", { symbol: state.symbol })}</p>}
    </div>
  );
}

function StepCryptoAsset(props: {
  assets: Asset[];
  balances: Record<string, bigint> | undefined;
  market: Market | undefined;
  networkName: string;
  selected: string | null;
  onSelect: (key: string) => void;
  amountMode: "all" | "custom";
  setAmountMode: (mode: "all" | "custom") => void;
  amountInput: string;
  setAmountInput: (value: string) => void;
  maxLockable: bigint;
  gasReserve: bigint;
  amountError: "invalid" | "tooHigh" | null;
}) {
  const { t, locale } = useI18n();
  const { preferences } = usePreferences();
  const { chainId } = useNetwork();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const balanceOf = (a: Asset) => props.balances?.[a.key] ?? 0n;
  const rank = (a: Asset) => (balanceOf(a) > 0n ? 0 : 1);
  const visible = props.assets
    .filter((a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.key === q)
    .map((a, index) => ({ a, index, usd: usdValue(props.market, a, balanceOf(a)) ?? -1 }))
    .sort(
      (x, y) =>
        rank(x.a) - rank(y.a) ||
        Number(y.a.kind === "native") - Number(x.a.kind === "native") ||
        y.usd - x.usd ||
        x.index - y.index,
    )
    .map((entry) => entry.a);
  const asset = props.assets.find((a) => a.key === props.selected);

  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.asset.title")}</h2>
      {chainId !== LOCAL_CHAIN_ID && (
        <p className="small muted">
          {preferences.detectTokens ? t("create.asset.detected") : t("create.asset.detectionOff")}{" "}
          {t("create.asset.otherChains", { network: props.networkName })}
        </p>
      )}
      <label className="search">
        <IconSearch />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("create.asset.search")} aria-label={t("create.asset.search")} />
      </label>
      <div className="option-list" aria-label={t("create.asset.title")}>
        {visible.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>{t("create.asset.noResults")}</p>}
        {visible.map((a) => {
          const bal = props.balances?.[a.key] ?? 0n;
          const value = usdValue(props.market, a, bal);
          return (
            <button
              key={a.key}
              type="button"
              aria-pressed={a.key === props.selected}
              className="option-row"
              disabled={bal === 0n}
              onClick={() => props.onSelect(a.key)}
            >
              <TokenIcon symbol={a.symbol} />
              <span className="option-text">
                <strong>{a.name}</strong>
                <span className="muted small">
                  {a.symbol} · {props.networkName}
                  {a.source === "custom" && ` · ${t("create.asset.custom")}`}
                </span>
              </span>
              <span className="option-meta">
                <span className="num">
                  {bal === 0n ? t("create.asset.noBalance") : `${formatAmount(bal, a.decimals, locale)} ${a.symbol}`}
                </span>
                <span className="muted small num">{value !== undefined ? formatUsd(value, locale) : t("dash.noPrice")}</span>
              </span>
            </button>
          );
        })}
      </div>

      <AddTokenForm networkName={props.networkName} onAdded={(key) => props.onSelect(key)} />

      {asset && (
        <div className="panel stack-16 fade-in">
          <div className="row-8" style={{ justifyContent: "space-between" }}>
            <h3>{t("create.amount.title")}</h3>
            <div className="segmented" role="group">
              <button type="button" aria-pressed={props.amountMode === "all"} onClick={() => props.setAmountMode("all")}>
                {t("create.amount.all")}
              </button>
              <button type="button" aria-pressed={props.amountMode === "custom"} onClick={() => props.setAmountMode("custom")}>
                {t("create.amount.custom")}
              </button>
            </div>
          </div>
          {props.amountMode === "all" ? (
            <div className="big-date num">
              {formatAmount(props.maxLockable, asset.decimals, locale)} {asset.symbol}
            </div>
          ) : (
            <div className="input-wrap">
              <input
                className="input input-lg"
                inputMode="decimal"
                autoFocus
                placeholder="0.0"
                value={props.amountInput}
                onChange={(e) => props.setAmountInput(e.target.value)}
                aria-label={t("create.amount.title")}
              />
              <span className="input-suffix">{asset.symbol}</span>
            </div>
          )}
          <div className="row-8 small muted">
            <span>
              {t("create.amount.available", {
                amount: `${formatAmount(props.maxLockable, asset.decimals, locale)} ${asset.symbol}`,
              })}
            </span>
            {props.amountMode === "custom" && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => props.setAmountInput(formatAmount(props.maxLockable, asset.decimals, "en-US", asset.decimals).replace(/,/g, ""))}
              >
                {t("common.max")}
              </button>
            )}
          </div>
          {props.gasReserve > 0n && (
            <p className="small muted">
              {t("create.amount.gasReserve", { amount: `${formatAmount(props.gasReserve, asset.decimals, locale)} ${asset.symbol}` })}
            </p>
          )}
          {props.amountError === "invalid" && <p className="error-text">{t("create.amount.invalid")}</p>}
          {props.amountError === "tooHigh" && <p className="error-text">{t("create.amount.tooHigh")}</p>}
        </div>
      )}
    </section>
  );
}

function StepWallet(props: {
  owner: Address;
  account: ReturnType<typeof useLockAccount>["data"];
  loading: boolean;
  assets: Asset[];
  balances: Record<string, bigint> | undefined;
  market: Market | undefined;
}) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { deployment, chainId } = useNetwork();
  const createFlow = useTxFlow();
  const [depositOpen, setDepositOpen] = useState(false);
  const account = props.account;
  const held = props.assets.filter((a) => (props.balances?.[a.key] ?? 0n) > 0n);

  const createAccount = () =>
    createFlow.run([
      {
        id: "create-account",
        label: t("create.tx.createAccount"),
        send: async () => {
          const { request } = await simulateContract(config, {
            address: deployment!.contracts.accountFactory,
            abi: lockableAccountFactoryAbi,
            functionName: "createAccount",
            args: [props.owner, 0n],
            account: props.owner,
          });
          return writeContract(config, request);
        },
      },
    ]);

  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.wallet.title")}</h2>
      <dl className="dl dl-single">
        <DetailRow label={t("create.wallet.connected")}>
          <AddressLink address={props.owner} chainId={chainId} />
        </DetailRow>
        <DetailRow label={t("create.wallet.account")}>
          {account ? <AddressLink address={account.address} chainId={chainId} /> : "…"}
        </DetailRow>
      </dl>

      <div className="panel stack-8">
        <h3>{t("create.wallet.explainTitle")}</h3>
        <p>{t("create.wallet.explain1")}</p>
        <p>{t("create.wallet.explain2")}</p>
        <p className="muted">{t("create.wallet.explain3")}</p>
      </div>

      {props.loading || !account ? null : !account.deployed ? (
        <div className="stack-16">
          <p className="muted">{t("create.wallet.createHint")}</p>
          <button type="button" className="btn" onClick={createAccount} disabled={createFlow.status === "running"}>
            {t("create.wallet.create")}
          </button>
          <TxProgress steps={createFlow.steps} error={createFlow.error} chainId={chainId} />
        </div>
      ) : account.isLocked ? (
        <Notice tone="solid">{t("create.wallet.alreadyLocked", { date: formatDate(account.lockedUntil, locale) })}</Notice>
      ) : (
        <>
          <div>
            <div className="section-head">
              <h3>{t("create.wallet.assets")}</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDepositOpen(true)}>
                {t("create.wallet.deposit")}
              </button>
            </div>
            {held.length === 0 ? (
              <div style={{ paddingTop: 16 }}>
                <Notice>{t("create.wallet.emptyAccount")}</Notice>
              </div>
            ) : (
              <div className="option-list" style={{ borderTop: 0 }}>
                {held.map((a) => {
                  const bal = props.balances?.[a.key] ?? 0n;
                  const value = usdValue(props.market, a, bal);
                  return (
                    <div key={a.key} className="option-row" style={{ cursor: "default" }}>
                      <TokenIcon symbol={a.symbol} />
                      <span className="option-text">
                        <strong>{a.name}</strong>
                        <span className="muted small">{a.symbol}</span>
                      </span>
                      <span className="option-meta">
                        <span className="num">
                          {formatAmount(bal, a.decimals, locale)} {a.symbol}
                        </span>
                        <span className="muted small num">{value !== undefined ? formatUsd(value, locale) : t("dash.noPrice")}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {account.approvals.some((a) => a.live) && (
            <div className="stack-16">
              <Notice>
                <p>
                  <strong>{t("create.wallet.approvalsTitle")}</strong>
                </p>
                <p className="muted">{t("create.wallet.approvalsBody")}</p>
              </Notice>
              <ApprovalsList account={account} onlyLive />
            </div>
          )}
          <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} account={account.address} />
        </>
      )}
    </section>
  );
}

function StakingDetails({
  vault,
  shareToken,
  underlying,
  amount,
  chainId,
}: {
  vault: Address;
  shareToken: Asset | undefined;
  underlying: Asset;
  amount: bigint;
  chainId?: number;
}) {
  const { t, locale } = useI18n();
  const apy = useVaultApy(vault, shareToken?.decimals ?? underlying.decimals).data;
  const yearly = apy?.apy != null ? toFloat(amount, underlying.decimals) * apy.apy : null;
  return (
    <dl className="dl dl-single">
      <DetailRow label={t("create.staking.apy")}>
        {apy?.apy != null ? (
          <>
            <strong className="num">{(apy.apy * 100).toLocaleString(locale, { maximumFractionDigits: 2 })}%</strong>
            <div className="small muted">{t("create.staking.apyTrailing", { days: apy.windowDays })}</div>
          </>
        ) : (
          <span className="muted">{t("create.staking.apyUnknown")}</span>
        )}
      </DetailRow>
      <DetailRow label={t("create.staking.rewards")}>
        {yearly !== null && amount > 0n ? (
          <span className="small">
            {t("create.staking.rewardsValue", {
              amount: `${yearly.toLocaleString(locale, { maximumFractionDigits: 4 })} ${underlying.symbol}`,
            })}
          </span>
        ) : (
          t("common.none")
        )}
      </DetailRow>
      <DetailRow label={t("create.staking.frequency")}>
        <span className="small">{t("create.staking.frequencyValue")}</span>
      </DetailRow>
      <DetailRow label={t("create.staking.conditions")}>
        <span className="small">
          {t("create.staking.conditionsValue", { vault: shareToken?.name ?? vault })} <AddressLink address={vault} chainId={chainId} />
        </span>
      </DetailRow>
      <DetailRow label={t("create.staking.risks")}>
        <span className="small">{t("create.staking.risksValue")}</span>
      </DetailRow>
    </dl>
  );
}

function StepCryptoStaking(props: {
  asset: Asset;
  vault: Address | undefined;
  assets: Asset[];
  amount: bigint;
  stake: boolean | null;
  setStake: (value: boolean) => void;
  comingSoon: boolean;
  networkName: string;
  chainId?: number;
}) {
  const { t } = useI18n();
  const shareToken = props.vault ? props.assets.find((a) => a.key === props.vault!.toLowerCase()) : undefined;
  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.staking.title")}</h2>
      {!props.vault && (
        <Notice>
          {props.comingSoon
            ? t("create.staking.comingSoonBody")
            : t("create.staking.unavailable", { asset: props.asset.symbol, network: props.networkName })}
        </Notice>
      )}
      <div className="grid-lines choice-grid">
        <button
          type="button"
          className="choice"
          aria-pressed={props.stake === true}
          disabled={!props.vault}
          onClick={() => props.setStake(true)}
        >
          {props.comingSoon && <span className="chip chip-solid">{t("create.staking.comingSoon")}</span>}
          <span className="choice-title">{t("create.staking.yes")}</span>
          <p className="muted">{t("create.staking.yesBody")}</p>
        </button>
        <button type="button" className="choice" aria-pressed={props.stake === false} onClick={() => props.setStake(false)}>
          <span className="choice-title">{t("create.staking.no")}</span>
          <p className="muted">{t("create.staking.noBody")}</p>
        </button>
      </div>
      {props.vault && (
        <StakingDetails
          vault={props.vault}
          shareToken={shareToken}
          underlying={props.asset}
          amount={props.amount}
          chainId={props.chainId}
        />
      )}
    </section>
  );
}

function StepWalletStaking(props: {
  eligible: Asset[];
  assets: Asset[];
  terms: Terms | undefined;
  balances: Record<string, bigint> | undefined;
  selected: Record<string, boolean>;
  setSelected: (value: Record<string, boolean>) => void;
  comingSoon: boolean;
  networkName: string;
  chainId?: number;
}) {
  const { t, locale } = useI18n();
  if (props.eligible.length === 0) {
    return (
      <section className="stack-24">
        <h2 className="h2">{t("create.staking.title")}</h2>
        <Notice>
          {props.comingSoon
            ? t("create.staking.comingSoonBody")
            : t("create.staking.unavailableWallet", { network: props.networkName })}
        </Notice>
        <div className="grid-lines choice-grid">
          <button type="button" className="choice" disabled>
            {props.comingSoon && <span className="chip chip-solid">{t("create.staking.comingSoon")}</span>}
            <span className="choice-title">{t("create.staking.yes")}</span>
          </button>
          <button type="button" className="choice" aria-pressed>
            <span className="choice-title">{t("create.staking.no")}</span>
            <p className="muted">{t("create.staking.noBody")}</p>
          </button>
        </div>
      </section>
    );
  }
  const anySelected = props.eligible.some((a) => props.selected[a.key]);
  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.staking.title")}</h2>
      <div className="grid-lines choice-grid">
        <button
          type="button"
          className="choice"
          aria-pressed={anySelected}
          onClick={() => props.setSelected(Object.fromEntries(props.eligible.map((a) => [a.key, true])))}
        >
          <span className="choice-title">{t("create.staking.yes")}</span>
          <p className="muted">{t("create.staking.yesBody")}</p>
        </button>
        <button type="button" className="choice" aria-pressed={!anySelected} onClick={() => props.setSelected({})}>
          <span className="choice-title">{t("create.staking.no")}</span>
          <p className="muted">{t("create.staking.noBody")}</p>
        </button>
      </div>
      <div>
        <div className="section-head">
          <h3>{t("create.staking.selectAssets")}</h3>
        </div>
        {props.eligible.map((a) => {
          const vault = props.terms!.stakingVaults[a.key] as Address;
          const shareToken = props.assets.find((s) => s.key === vault.toLowerCase());
          const bal = props.balances?.[a.key] ?? 0n;
          const checked = !!props.selected[a.key];
          return (
            <div key={a.key} className="stack-16" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <label className="row-8" style={{ justifyContent: "space-between", cursor: "pointer" }}>
                <span className="asset-cell">
                  <TokenIcon symbol={a.symbol} />
                  <span>
                    <strong>
                      {formatAmount(bal, a.decimals, locale)} {a.symbol}
                    </strong>
                    <span className="asset-sub">{t("create.staking.stakeAll")}</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={checked}
                  onChange={(e) => props.setSelected({ ...props.selected, [a.key]: e.target.checked })}
                />
              </label>
              {checked && <StakingDetails vault={vault} shareToken={shareToken} underlying={a} amount={bal} chainId={props.chainId} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StepDuration(props: {
  terms: Terms | undefined;
  preset: Preset | null;
  setPreset: (preset: Preset) => void;
  customUnlock: string;
  setCustomUnlock: (value: string) => void;
  unlockTime: number | null;
  durationOk: boolean;
  now: number;
}) {
  const { t, locale } = useI18n();
  const terms = props.terms;
  const duration = props.unlockTime !== null ? props.unlockTime - props.now : 0;
  const days = Math.floor(duration / 86_400);
  return (
    <section className="stack-24">
      <h2 className="h2">{t("create.duration.title")}</h2>
      <div className="grid-lines duration-grid" role="group">
        {PRESETS.map((d) => {
          const allowed = !terms || (d * 86_400 >= terms.minDuration && d * 86_400 <= terms.maxDuration);
          return (
            <button key={d} type="button" aria-pressed={props.preset === d} disabled={!allowed} onClick={() => props.setPreset(d)}>
              {t("create.duration.days", { n: d })}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={props.preset === "custom"}
          onClick={() => {
            props.setPreset("custom");
            if (!props.customUnlock) props.setCustomUnlock(toLocalInput(props.now + 30 * 86_400));
          }}
        >
          {t("create.duration.custom")}
        </button>
      </div>

      {props.preset === "custom" && terms && (
        <label className="field fade-in">
          <span className="field-label eyebrow">{t("create.duration.customLabel")}</span>
          <input
            type="datetime-local"
            className="input"
            value={props.customUnlock}
            min={toLocalInput(props.now + terms.minDuration)}
            max={toLocalInput(props.now + terms.maxDuration)}
            onChange={(e) => props.setCustomUnlock(e.target.value)}
          />
        </label>
      )}

      {terms && (
        <p className="small muted">
          {t("create.duration.limits", {
            min: formatDurationLong(terms.minDuration, t),
            max: formatDurationLong(terms.maxDuration, t),
          })}
        </p>
      )}

      {props.unlockTime !== null && (
        <div className="fade-in">
          <div className="duration-display">
            <div>
              <div className="eyebrow">{t("create.duration.title")}</div>
              <div className="big-number">
                {days >= 1 ? t("create.duration.daysBig", { n: days }) : formatDurationLong(Math.max(duration, 0), t)}
              </div>
            </div>
            <div>
              <div className="eyebrow">{t("create.duration.unlockDate")}</div>
              <div className="big-date">{formatDate(props.unlockTime, locale)}</div>
            </div>
          </div>
          {props.durationOk ? (
            <Countdown target={props.unlockTime} now={props.now} />
          ) : (
            <p className="error-text">{t("create.duration.outOfRange")}</p>
          )}
          <div style={{ marginTop: 24 }}>
            <Notice tone="solid">{t("create.duration.warning")}</Notice>
          </div>
        </div>
      )}
    </section>
  );
}

function EarlyUnlockTerms({ terms, isWallet }: { terms: Terms; isWallet: boolean }) {
  const { t, locale } = useI18n();
  const min = formatBps(terms.minFeeBps, locale);
  const max = formatBps(terms.maxFeeBps, locale);
  const points = [0, 0.25, 0.5, 0.75, 0.99];
  return (
    <div className="panel stack-16">
      <h3>{t("create.review.earlyTitle")}</h3>
      <p>{t("create.review.earlyBody", { min, max })}</p>
      <div className="formula">{t("create.review.earlyFormula", { min, max })}</div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {t("create.review.schedule")}
        </div>
        <div className="grid-lines schedule">
          {points.map((p) => (
            <div key={p}>
              <div className="small muted">{t("create.review.elapsed", { pct: Math.round(p * 100) })}</div>
              <div className="num" style={{ fontWeight: 600, marginTop: 4 }}>
                {formatBps(feeBpsAfterShare(terms.minFeeBps, terms.maxFeeBps, p), locale)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {isWallet && <p className="small muted">{t("create.review.walletFeeScope")}</p>}
    </div>
  );
}
