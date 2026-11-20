"use client";

import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { explorerUrl } from "@/config/chains";
import { useI18n } from "@/lib/i18n";
import { shortAddress, splitDuration } from "@/lib/format";
import { IconAlert, IconCheck, IconCopy, IconExternal, Spinner } from "./Icons";
import type { StepView } from "@/hooks/useTxFlow";
import type { ErrorMessage } from "@/lib/errors";

export type LockState = "active" | "unlockable" | "completed" | "early" | "unlocked" | "notCreated";

export function StatusChip({ state }: { state: LockState }) {
  const { t } = useI18n();
  const label = {
    active: t("status.active"),
    unlockable: t("status.unlockable"),
    completed: t("status.completed"),
    early: t("status.early"),
    unlocked: t("status.unlocked"),
    notCreated: t("status.notCreated"),
  }[state];
  const solid = state === "active";
  return (
    <span className={`chip${solid ? " chip-solid" : ""}${state === "unlockable" ? " chip-attention" : ""}`}>
      {(state === "active" || state === "unlockable") && <span className="chip-dot" aria-hidden />}
      {label}
    </span>
  );
}

export function Countdown({ target, now }: { target: number; now: number }) {
  const { t } = useI18n();
  const { days, hours, minutes, seconds } = splitDuration(target - now);
  const cells: Array<[number, string]> = [
    [days, t("detail.countdown.days")],
    [hours, t("detail.countdown.hours")],
    [minutes, t("detail.countdown.minutes")],
    [seconds, t("detail.countdown.seconds")],
  ];
  return (
    <div className="countdown" role="timer" aria-live="off">
      {cells.map(([value, label]) => (
        <div key={label} className="countdown-cell">
          <div className="countdown-value num">{String(value).padStart(2, "0")}</div>
          <div className="countdown-label eyebrow">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function AddressLink({ address, chainId, full }: { address: Address; chainId?: number; full?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const url = explorerUrl(chainId, "address", address);
  return (
    <span className="address">
      <span className={`mono${full ? " break" : ""}`} title={address}>
        {full ? address : shortAddress(address)}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("wallet.copy")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          } catch {
          }
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
      {url && (
        <a className="icon-btn" href={url} target="_blank" rel="noreferrer" aria-label={t("common.explorer")}>
          <IconExternal size={14} />
        </a>
      )}
    </span>
  );
}

export function TxLink({ hash, chainId }: { hash: string; chainId?: number }) {
  const url = explorerUrl(chainId, "tx", hash);
  if (!url) return <span className="mono small">{shortAddress(hash)}</span>;
  return (
    <a className="mono small link" href={url} target="_blank" rel="noreferrer">
      {shortAddress(hash)} <IconExternal size={12} />
    </a>
  );
}

export function TxProgress({ steps, error, chainId }: { steps: StepView[]; error: ErrorMessage | null; chainId?: number }) {
  const { t } = useI18n();
  if (steps.length === 0 && !error) return null;
  const label = {
    waiting: t("tx.waiting"),
    signing: t("tx.signing"),
    pending: t("tx.pending"),
    done: t("tx.done"),
    error: t("tx.failed"),
  };
  return (
    <div className="tx-progress">
      {steps.map((step, i) => (
        <div key={step.id} className={`tx-step is-${step.state}`}>
          <span className="tx-index mono">{String(i + 1).padStart(2, "0")}</span>
          <span className="tx-label">{step.label}</span>
          <span className="tx-state small">
            {(step.state === "signing" || step.state === "pending") && <Spinner size={12} />}
            {step.state === "done" && <IconCheck size={14} />}
            {label[step.state]}
          </span>
          {step.hash && (
            <span className="tx-hash">
              <TxLink hash={step.hash} chainId={chainId} />
            </span>
          )}
        </div>
      ))}
      {error && (
        <p className="error-text" role="alert">
          {t(error.key, error.vars)}
        </p>
      )}
    </div>
  );
}

export function Notice({ children, tone = "default", icon = true }: { children: ReactNode; tone?: "default" | "solid"; icon?: boolean }) {
  return (
    <div className={`notice${tone === "solid" ? " notice-solid" : ""}`}>
      {icon && <IconAlert size={18} />}
      <div className="notice-body">{children}</div>
    </div>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden />;
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="h2">{title}</h2>
      {children && <div className="section-actions">{children}</div>}
    </div>
  );
}
