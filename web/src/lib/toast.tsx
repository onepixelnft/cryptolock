"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import { usePreferences } from "./preferences";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
  href?: string;
}

interface ToastValue {
  notify: (toast: Omit<Toast, "id">, options?: { force?: boolean }) => void;
}

const ToastContext = createContext<ToastValue>({ notify: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { preferences } = usePreferences();
  const { t } = useI18n();

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const notify = useCallback<ToastValue["notify"]>(
    (toast, options) => {
      if (!options?.force && toast.kind !== "error" && !preferences.notifyTransactions) return;
      const id = nextId++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.kind === "error" ? 9_000 : 5_000);
    },
    [dismiss, preferences.notifyTransactions],
  );

  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-mark" aria-hidden />
            {toast.href ? (
              <a href={toast.href} target="_blank" rel="noreferrer" className="toast-message">
                {toast.message}
              </a>
            ) : (
              <span className="toast-message">{toast.message}</span>
            )}
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t("common.dismiss")}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
