"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDisconnect, useSignMessage } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { GITHUB_URL } from "@/components/Footer";
import { IconShield } from "@/components/Icons";
import { NetworkList } from "@/components/NetworkButton";
import { AddressLink, DetailRow, Notice, SectionHead } from "@/components/ui";
import { useNetwork } from "@/hooks/useNetwork";
import { describeError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { INDEXER_URL, preferencesMessage, savePreferences } from "@/lib/indexer";
import { usePreferences } from "@/lib/preferences";
import { useMounted } from "@/lib/useMounted";

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SettingsPage() {
  const { t } = useI18n();
  const mounted = useMounted();
  const { address, isConnected, connector, chain, chainId, deployment, status } = useNetwork();
  const { disconnect } = useDisconnect();
  const { preferences, update } = usePreferences();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [syncState, setSyncState] = useState<"idle" | "saved" | "error">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const toggleMaturity = async (enabled: boolean) => {
    update({ notifyMaturity: enabled });
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
  };

  const sync = async () => {
    if (!address || !chainId) return;
    setSyncState("idle");
    setSyncError(null);
    try {
      const issuedAt = new Date().toISOString();
      const nonce = randomNonce();
      const message = preferencesMessage(address, preferences, issuedAt, nonce);
      const signature = await signMessageAsync({ message });
      const ok = await savePreferences({ address, chainId, preferences, issuedAt, nonce, signature });
      setSyncState(ok ? "saved" : "error");
      if (!ok) setSyncError(t("error.generic", { detail: "server refused the request" }));
    } catch (error) {
      const message = describeError(error);
      setSyncState("error");
      setSyncError(t(message.key, message.vars));
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="h2">{t("settings.title")}</h1>
      </div>

      <section className="section">
        <SectionHead title={t("settings.wallet")} />
        {!mounted ? null : !isConnected || !address ? (
          <div className="gate" style={{ padding: "24px 0" }}>
            <p className="muted">{t("wallet.notConnectedBody")}</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <dl className="dl dl-single">
              <DetailRow label={t("settings.connectedWith")}>{connector?.name}</DetailRow>
              <DetailRow label={t("settings.address")}>
                <AddressLink address={address} chainId={chainId} full />
              </DetailRow>
              <DetailRow label={t("settings.network")}>
                {chain ? `${chain.name} · ${chain.id}` : t("network.unsupported")}
              </DetailRow>
            </dl>
            <div style={{ marginTop: 16 }}>
              <NetworkList />
            </div>
            <div className="row-8" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => disconnect()}>
                {t("wallet.disconnect")}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="section">
        <SectionHead title={t("settings.notifications")} />
        <div className="option-list" style={{ borderTop: 0 }}>
          <label className="option-row" style={{ cursor: "pointer" }}>
            <span className="option-text">
              <strong>{t("settings.notifyMaturity")}</strong>
              <span className="muted small">
                {permission === "denied" ? t("settings.permissionDenied") : t("settings.notifyMaturityHint")}
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={preferences.notifyMaturity}
              disabled={permission === "unsupported"}
              onChange={(e) => void toggleMaturity(e.target.checked)}
            />
          </label>
          <div className="option-row" style={{ cursor: "default", flexWrap: "wrap" }}>
            <span className="option-text">
              <strong>{t("settings.notifyReminder")}</strong>
            </span>
            <div className="segmented" role="group" aria-label={t("settings.notifyReminder")}>
              {[0, 1, 3, 7].map((n) => (
                <button key={n} type="button" aria-pressed={preferences.reminderDays === n} onClick={() => update({ reminderDays: n })}>
                  {n === 0 ? t("settings.notifyReminderOff") : t("settings.notifyReminderDays", { n })}
                </button>
              ))}
            </div>
          </div>
          <label className="option-row" style={{ cursor: "pointer" }}>
            <span className="option-text">
              <strong>{t("settings.notifyTx")}</strong>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={preferences.notifyTransactions}
              onChange={(e) => update({ notifyTransactions: e.target.checked })}
            />
          </label>
          <div className="option-row is-disabled" aria-disabled>
            <span className="option-text">
              <strong>{t("settings.notifyEmail")}</strong>
              <span className="muted small">{t("settings.notAvailable")}</span>
            </span>
            <input type="checkbox" className="switch" disabled checked={false} readOnly />
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead title={t("settings.tokens")} />
        <div className="option-list" style={{ borderTop: 0 }}>
          <label className="option-row" style={{ cursor: "pointer" }}>
            <span className="option-text">
              <strong>{t("settings.detectTokens")}</strong>
              <span className="muted small">{t("settings.detectTokensHint")}</span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={preferences.detectTokens}
              onChange={(e) => update({ detectTokens: e.target.checked })}
            />
          </label>
        </div>
      </section>

      <section className="section">
        <SectionHead title={t("settings.language")} />
        <div style={{ paddingTop: 16 }}>
          <div className="segmented" role="group" aria-label={t("settings.language")}>
            <button type="button" aria-pressed={preferences.language === "en"} onClick={() => update({ language: "en" })} lang="en">
              English
            </button>
            <button type="button" aria-pressed={preferences.language === "fr"} onClick={() => update({ language: "fr" })} lang="fr">
              Français
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead title={t("settings.storage")} />
        <div className="stack-16" style={{ paddingTop: 16 }}>
          <p className="muted">{t("settings.storageLocal")}</p>
          {INDEXER_URL ? (
            <>
              <p className="small muted">{t("settings.storageSyncHint")}</p>
              <div className="row-8">
                <button type="button" className="btn btn-secondary" onClick={sync} disabled={!address || signing}>
                  {t("settings.storageSync")}
                </button>
                {syncState === "saved" && <span className="small">{t("settings.storageSynced")}</span>}
              </div>
              {syncError && <p className="error-text">{syncError}</p>}
            </>
          ) : (
            <p className="small muted">{t("settings.storageUnavailable")}</p>
          )}
        </div>
      </section>

      {mounted && status === "ready" && deployment && (
        <section className="section">
          <SectionHead title={t("settings.contracts")} />
          <dl className="dl dl-single">
            <DetailRow label="LockVault">
              <AddressLink address={deployment.contracts.lockVault} chainId={chainId} />
            </DetailRow>
            <DetailRow label="LockableAccountFactory">
              <AddressLink address={deployment.contracts.accountFactory} chainId={chainId} />
            </DetailRow>
            <DetailRow label="ProtocolConfig">
              <AddressLink address={deployment.contracts.protocolConfig} chainId={chainId} />
            </DetailRow>
          </dl>
        </section>
      )}

      <section className="section">
        <SectionHead title={t("settings.resources")} />
        <div className="option-list" style={{ borderTop: 0 }}>
          <Link href="/docs" className="option-row">
            <span className="option-text">
              <strong>{t("settings.docs")}</strong>
            </span>
          </Link>
          <Link href="/terms" className="option-row">
            <span className="option-text">
              <strong>{t("settings.terms")}</strong>
            </span>
          </Link>
          <Link href="/security" className="option-row">
            <span className="option-text">
              <strong>{t("settings.security")}</strong>
            </span>
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="option-row">
            <span className="option-text">
              <strong>{t("settings.sourceCode")}</strong>
              <span className="muted small">github.com/onepixelnft/cryptolock</span>
            </span>
          </a>
        </div>
      </section>

      <section className="section">
        <Notice tone="solid" icon={false}>
          <p className="row-8" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
            <IconShield size={18} />
            <span>{t("settings.neverAsk")}</span>
          </p>
        </Notice>
      </section>
    </div>
  );
}
