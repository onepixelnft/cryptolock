"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type Lang = "en" | "fr";

export interface Preferences {
  language: Lang;
  notifyMaturity: boolean;
  reminderDays: number;
  notifyTransactions: boolean;
  detectTokens: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "en",
  notifyMaturity: true,
  reminderDays: 3,
  notifyTransactions: true,
  detectTokens: true,
};

const STORAGE_KEY = "lock.preferences.v1";

export function sanitizePreferences(input: unknown): Partial<Preferences> {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (raw.language === "en" || raw.language === "fr") out.language = raw.language;
  if (typeof raw.notifyMaturity === "boolean") out.notifyMaturity = raw.notifyMaturity;
  if (typeof raw.notifyTransactions === "boolean") out.notifyTransactions = raw.notifyTransactions;
  if (typeof raw.detectTokens === "boolean") out.detectTokens = raw.detectTokens;
  if (typeof raw.reminderDays === "number" && [0, 1, 3, 7].includes(raw.reminderDays)) out.reminderDays = raw.reminderDays;
  return out;
}

interface PreferencesContextValue {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  applyRemote: (remote: Partial<Preferences>, remoteUpdatedAt: number) => void;
  loaded: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: DEFAULT_PREFERENCES,
  update: () => {},
  applyRemote: () => {},
  loaded: false,
});

function persist(preferences: Preferences, updatedAt: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, updatedAt }));
  } catch {
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const updatedAt = useRef(0);

  useEffect(() => {
    let stored: Partial<Preferences> = {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        stored = sanitizePreferences(parsed);
        if (typeof parsed.updatedAt === "number") updatedAt.current = parsed.updatedAt;
      }
    } catch {
    }
    const language: Lang = stored.language ?? "en";
    setPreferences({ ...DEFAULT_PREFERENCES, ...stored, language });
    setLoaded(true);
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...sanitizePreferences(patch) };
      updatedAt.current = Date.now();
      persist(next, updatedAt.current);
      return next;
    });
  }, []);

  const applyRemote = useCallback((remote: Partial<Preferences>, remoteUpdatedAt: number) => {
    if (!(remoteUpdatedAt > updatedAt.current)) return;
    setPreferences((current) => {
      const next = { ...current, ...sanitizePreferences(remote) };
      updatedAt.current = remoteUpdatedAt;
      persist(next, remoteUpdatedAt);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ preferences, update, applyRemote, loaded }), [preferences, update, applyRemote, loaded]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
