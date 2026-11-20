"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSwitchChain } from "wagmi";
import { AUTO_SWITCH, PREFERRED_CHAIN_ID } from "@/config/chains";
import { getDeployment } from "@/config/deployments";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { NetworkBanner } from "./NetworkBanner";
import { useNetwork } from "@/hooks/useNetwork";
import { useNftLocks } from "@/hooks/nft";
import { useAssets, useCryptoLocks, useLockAccount } from "@/hooks/protocol";
import { useChainNow } from "@/lib/chainClock";
import { useI18n } from "@/lib/i18n";
import { fetchPreferences } from "@/lib/indexer";
import { usePreferences } from "@/lib/preferences";
import { useToast } from "@/lib/toast";

function PreferencesSync() {
  const { address } = useNetwork();
  const { applyRemote, loaded } = usePreferences();
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!address || !loaded || synced.current === address) return;
    synced.current = address;
    fetchPreferences(address).then((remote) => {
      if (remote) applyRemote(remote.preferences, remote.updatedAt);
    });
  }, [address, loaded, applyRemote]);
  return null;
}

function PreferredNetwork() {
  const { address, isConnected, status, chainId } = useNetwork();
  const { switchChain } = useSwitchChain();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!AUTO_SWITCH || !isConnected || !address || status === "ready" || status === "disconnected") return;
    if (chainId === PREFERRED_CHAIN_ID || !getDeployment(PREFERRED_CHAIN_ID) || asked.current === address) return;
    asked.current = address;
    switchChain({ chainId: PREFERRED_CHAIN_ID });
  }, [address, isConnected, status, chainId, switchChain]);
  return null;
}

function MaturityNotifier() {
  const { address, deployment, chainId } = useNetwork();
  const { t } = useI18n();
  const { notify } = useToast();
  const { preferences } = usePreferences();
  const now = useChainNow();
  const { data: locks } = useCryptoLocks(address);
  const { data: nftLocks } = useNftLocks(address);
  const { data: account } = useLockAccount(address);
  const { resolve } = useAssets();
  const watched = useRef(new Map<string, { end: number; label: string }>());

  useEffect(() => {
    if (!deployment || now === 0) return;
    const scope = `${chainId}:${address}:`;
    const active = new Map<string, { end: number; label: string }>();
    for (const lock of locks ?? []) {
      if (lock.status === "active") {
        active.set(`${scope}c${lock.id}`, { end: lock.end, label: `${resolve(lock.token).symbol} #${lock.id}` });
      }
    }
    for (const lock of nftLocks ?? []) {
      if (lock.status === "active") active.set(`${scope}n${lock.id}`, { end: lock.end, label: `${t("type.nft")} #${lock.id}` });
    }
    if (account?.isLocked) active.set(`${scope}w${account.address}`, { end: account.lockedUntil, label: t("common.lockAccount") });

    for (const key of [...watched.current.keys()]) {
      if (!active.has(key)) watched.current.delete(key);
    }
    for (const [key, item] of active) {
      if (item.end > now && !watched.current.has(key)) watched.current.set(key, item);
    }
  }, [locks, nftLocks, account, deployment, now, t, resolve, chainId, address]);

  useEffect(() => {
    for (const [key, item] of watched.current) {
      if (now < item.end) continue;
      watched.current.delete(key);
      const body = t("notify.maturedBody", { asset: item.label });
      notify({ kind: "success", message: body }, { force: true });
      if (preferences.notifyMaturity && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(t("notify.maturedTitle"), { body });
        } catch {
        }
      }
    }
  }, [now, notify, preferences.notifyMaturity, t]);

  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <NetworkBanner />
      <main className="main">{children}</main>
      <Footer />
      <PreferencesSync />
      <PreferredNetwork />
      <MaturityNotifier />
    </>
  );
}
