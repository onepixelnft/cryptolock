"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";
import { RequireReady } from "@/components/RequireReady";
import { NftImage, useNftLabel } from "@/components/NftImage";
import { TokenIcon, WalletIcon } from "@/components/TokenIcon";
import { Notice, SectionHead, Skeleton, StatusChip } from "@/components/ui";
import { type NftLock, useCollectionName, useNftLocks } from "@/hooks/nft";
import { useAssets, useBalances, useCryptoLocks, useLockAccount, useMarket, usdValue } from "@/hooks/protocol";
import { useNetwork } from "@/hooks/useNetwork";
import { useChainNow } from "@/lib/chainClock";
import { formatAmount, formatShortDate, formatUsd, formatUsdCompact } from "@/lib/format";
import { formatDurationShort, useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { useMounted } from "@/lib/useMounted";

export default function HomePage() {
  const mounted = useMounted();
  const { status, isConnecting } = useNetwork();
  if (!mounted || (status === "disconnected" && !isConnecting)) return <Landing />;
  return (
    <div className="container page">
      <RequireReady>
        <Dashboard />
      </RequireReady>
    </div>
  );
}

function Landing() {
  const { t } = useI18n();
  const pillars = [
    [t("landing.p1.title"), t("landing.p1.body")],
    [t("landing.p2.title"), t("landing.p2.body")],
    [t("landing.p3.title"), t("landing.p3.body")],
  ];
  return (
    <div className="container fade-in">
      <section className="hero">
        <h1 className="h1">{t("landing.title")}</h1>
        <p className="lead">{t("landing.lead")}</p>
        <ConnectButton size="lg" />
      </section>
      <section className="pillars">
        {pillars.map(([title, body], i) => (
          <div key={title} className="pillar">
            <span className="pillar-index">0{i + 1}</span>
            <h3>{title}</h3>
            <p className="muted">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function Dashboard() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const now = useChainNow();
  const { preferences } = usePreferences();
  const { address, deployment } = useNetwork();
  const market = useMarket().data;
  const balances = useBalances(address);
  const locks = useCryptoLocks(address);
  const account = useLockAccount(address);
  const accountState = account.data;
  const accountBalances = useBalances(accountState?.deployed ? accountState.address : undefined).data;
  const nftLocks = useNftLocks(address);

  const { assets, resolve } = useAssets();
  const activeCrypto = (locks.data ?? []).filter((l) => l.status === "active");
  const activeNft = (nftLocks.data ?? []).filter((l) => l.status === "active");
  const walletLocked = !!accountState?.isLocked;

  let totalLocked = 0;
  let lockedMissing = false;
  for (const lock of activeCrypto) {
    const asset = resolve(lock.token);
    const value = usdValue(market, asset, lock.currentValue);
    if (value === undefined) lockedMissing = true;
    else totalLocked += value;
  }
  if (walletLocked && accountBalances) {
    for (const asset of assets) {
      const balance = accountBalances[asset.key] ?? 0n;
      if (balance === 0n) continue;
      const value = usdValue(market, asset, balance);
      if (value === undefined) lockedMissing = true;
      else totalLocked += value;
    }
  }

  let available = 0;
  let availableMissing = false;
  const freeSources = [balances.data, accountState?.deployed && !walletLocked ? accountBalances : undefined];
  for (const source of freeSources) {
    if (!source) continue;
    for (const asset of assets) {
      const balance = source[asset.key] ?? 0n;
      if (balance === 0n) continue;
      const value = usdValue(market, asset, balance);
      if (value === undefined) availableMissing = true;
      else available += value;
    }
  }

  const upcoming = [
    ...activeCrypto.filter((l) => l.end > now).map((l) => l.end),
    ...activeNft.filter((l) => l.end > now).map((l) => l.end),
    ...(walletLocked ? [accountState!.lockedUntil] : []),
  ];
  const nextUnlock = upcoming.length > 0 ? Math.min(...upcoming) : undefined;
  const activeCount = activeCrypto.length + activeNft.length + (walletLocked ? 1 : 0);
  const loading = locks.isLoading || account.isLoading || nftLocks.isLoading;

  const timeline = [
    ...activeCrypto.map((l) => ({ key: `c${l.id}`, end: l.end, href: `/locks/${l.id}`, label: `${resolve(l.token).symbol} #${l.id}` })),
    ...activeNft.map((l) => ({ key: `n${l.id}`, end: l.end, href: `/nft-locks/${l.id}`, label: `${t("type.nft")} #${l.id}` })),
  ];
  const reminders =
    preferences.reminderDays > 0
      ? timeline.filter((l) => l.end > now && l.end - now <= preferences.reminderDays * 86_400)
      : [];
  const matured = timeline.filter((l) => l.end <= now);

  return (
    <>
      <div className="page-head">
        <h1 className="h2">{t("dash.title")}</h1>
        <Link href="/create" className="btn">
          {t("dash.createLock")}
        </Link>
      </div>

      <section className="stats" aria-label={t("dash.title")}>
        <div className="stat">
          <div className="eyebrow">{t("dash.totalLocked")}</div>
          <div className="stat-value num" title={formatUsd(totalLocked, locale)}>
            {loading ? <Skeleton width="70%" height={30} /> : formatUsdCompact(totalLocked, locale)}
          </div>
          {lockedMissing && <div className="stat-sub">{t("dash.partialPrices")}</div>}
          {activeNft.length > 0 && <div className="stat-sub">{t("dash.nftNotValued")}</div>}
        </div>
        <div className="stat">
          <div className="eyebrow">{t("dash.activeLocks")}</div>
          <div className="stat-value num">{loading ? <Skeleton width="30%" height={30} /> : activeCount}</div>
        </div>
        <div className="stat">
          <div className="eyebrow">{t("dash.available")}</div>
          <div className="stat-value num" title={formatUsd(available, locale)}>
            {balances.isLoading ? <Skeleton width="70%" height={30} /> : formatUsdCompact(available, locale)}
          </div>
          {availableMissing && <div className="stat-sub">{t("dash.partialPrices")}</div>}
        </div>
        <div className="stat">
          <div className="eyebrow">{t("dash.nextUnlock")}</div>
          <div className="stat-value num">{nextUnlock ? formatShortDate(nextUnlock, locale) : t("common.none")}</div>
          {nextUnlock && <div className="stat-sub">{t("dash.inTime", { time: formatDurationShort(nextUnlock - now, t) })}</div>}
        </div>
      </section>

      {(reminders.length > 0 || matured.length > 0) && (
        <div className="section stack-8">
          {matured.map((l) => (
            <Notice key={`m${l.key}`}>
              <Link href={l.href} className="link">
                {t("dash.ready", { asset: l.label })}
              </Link>
            </Notice>
          ))}
          {reminders.map((l) => (
            <Notice key={`r${l.key}`}>
              {t("dash.reminder", { asset: l.label, time: formatDurationShort(l.end - now, t) })}
            </Notice>
          ))}
        </div>
      )}

      <section className="section">
        <SectionHead title={t("dash.myLocks")}>
          <Link href="/create" className="btn btn-secondary btn-sm">
            {t("dash.createLock")}
          </Link>
        </SectionHead>

        {loading ? (
          <div className="stack-16" style={{ paddingTop: 24 }}>
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : activeCount === 0 ? (
          <div className="empty">
            <h3>{t("dash.empty")}</h3>
            <p className="muted">{t("dash.emptyHint")}</p>
            <Link href="/create" className="btn">
              {t("dash.createLock")}
            </Link>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("table.asset")}</th>
                <th>{t("table.amount")}</th>
                <th>{t("table.start")}</th>
                <th>{t("table.end")}</th>
                <th>{t("table.remaining")}</th>
                <th>{t("table.type")}</th>
                <th>{t("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {walletLocked && accountState && (
                <tr
                  className="row-link"
                  tabIndex={0}
                  onClick={() => router.push("/wallet")}
                  onKeyDown={(e) => e.key === "Enter" && router.push("/wallet")}
                >
                  <td className="cell-primary">
                    <span className="asset-cell">
                      <WalletIcon />
                      <span>
                        <Link href="/wallet">
                          <strong>{t("common.lockAccount")}</strong>
                        </Link>
                        <span className="asset-sub mono">{accountState.address.slice(0, 10)}…</span>
                      </span>
                    </span>
                  </td>
                  <td data-label={t("table.amount")} className="num">
                    {t("common.allAssets")}
                  </td>
                  <td data-label={t("table.start")} className="num">
                    {accountState.locks[0] ? formatShortDate(accountState.locks[0].start, locale) : t("common.none")}
                  </td>
                  <td data-label={t("table.end")} className="num">
                    {formatShortDate(accountState.lockedUntil, locale)}
                  </td>
                  <td data-label={t("table.remaining")} className="num">
                    {formatDurationShort(accountState.lockedUntil - now, t)}
                  </td>
                  <td data-label={t("table.type")}>{t("type.wallet")}</td>
                  <td data-label={t("table.status")}>
                    <StatusChip state="active" />
                  </td>
                </tr>
              )}
              {activeNft.map((lock) => (
                <NftLockRow key={`nft-${lock.id}`} lock={lock} now={now} onOpen={(href) => router.push(href)} />
              ))}
              {activeCrypto.map((lock) => {
                const asset = resolve(lock.token);
                const href = `/locks/${lock.id}`;
                const unlockable = lock.end <= now;
                return (
                  <tr
                    key={lock.id.toString()}
                    className="row-link"
                    tabIndex={0}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => e.key === "Enter" && router.push(href)}
                  >
                    <td className="cell-primary">
                      <span className="asset-cell">
                        <TokenIcon symbol={asset.symbol} />
                        <span>
                          <Link href={href}>
                            <strong>{asset.name}</strong>
                          </Link>
                          <span className="asset-sub">
                            {asset.symbol} · #{lock.id.toString()}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label={t("table.amount")} className="num">
                      {formatAmount(lock.currentValue, asset.decimals, locale)} {asset.symbol}
                    </td>
                    <td data-label={t("table.start")} className="num">
                      {formatShortDate(lock.start, locale)}
                    </td>
                    <td data-label={t("table.end")} className="num">
                      {formatShortDate(lock.end, locale)}
                    </td>
                    <td data-label={t("table.remaining")} className="num">
                      {unlockable ? t("common.none") : formatDurationShort(lock.end - now, t)}
                    </td>
                    <td data-label={t("table.type")}>{t("type.crypto")}</td>
                    <td data-label={t("table.status")}>
                      <StatusChip state={unlockable ? "unlockable" : "active"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function NftLockRow({ lock, now, onOpen }: { lock: NftLock; now: number; onOpen: (href: string) => void }) {
  const { t, locale } = useI18n();
  const collectionName = useCollectionName(lock.collection).data ?? "";
  const label = useNftLabel(lock, collectionName);
  const href = `/nft-locks/${lock.id}`;
  const unlockable = lock.end <= now;
  return (
    <tr className="row-link" tabIndex={0} onClick={() => onOpen(href)} onKeyDown={(e) => e.key === "Enter" && onOpen(href)}>
      <td className="cell-primary">
        <span className="asset-cell">
          <NftImage nft={lock} size={28} />
          <span>
            <Link href={href}>
              <strong>{label}</strong>
            </Link>
            <span className="asset-sub">
              {collectionName || t("type.nft")} · #{lock.id.toString()}
            </span>
          </span>
        </span>
      </td>
      <td data-label={t("table.amount")} className="num">
        {lock.standard === "erc1155" ? t("history.nftUnits", { n: lock.amount.toString() }) : t("history.oneNft")}
      </td>
      <td data-label={t("table.start")} className="num">
        {formatShortDate(lock.start, locale)}
      </td>
      <td data-label={t("table.end")} className="num">
        {formatShortDate(lock.end, locale)}
      </td>
      <td data-label={t("table.remaining")} className="num">
        {unlockable ? t("common.none") : formatDurationShort(lock.end - now, t)}
      </td>
      <td data-label={t("table.type")}>{t("type.nft")}</td>
      <td data-label={t("table.status")}>
        <StatusChip state={unlockable ? "unlockable" : "active"} />
      </td>
    </tr>
  );
}
