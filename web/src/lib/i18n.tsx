"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { en, type TKey } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { usePreferences, type Lang } from "./preferences";

export type Vars = Record<string, string | number>;
export type Translate = (key: TKey, vars?: Vars) => string;

const dictionaries: Record<Lang, Record<TKey, string>> = { en, fr };

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

interface I18nValue {
  lang: Lang;
  locale: string;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({
  lang: "en",
  locale: "en-US",
  t: (key, vars) => interpolate(en[key], vars),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  const lang = preferences.language;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: lang === "fr" ? "fr-FR" : "en-US",
      t: (key, vars) => interpolate(dictionaries[lang][key] ?? en[key], vars),
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function formatDurationShort(seconds: number, t: Translate): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return t("duration.dh", { d, h });
  if (h > 0) return t("duration.hm", { h, m });
  return t("duration.ms", { m, s: s % 60 });
}

export function formatDurationLong(seconds: number, t: Translate): string {
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400);
    return days === 1 ? t("duration.oneDay") : t("duration.days", { n: days });
  }
  if (seconds >= 3_600) {
    const hours = Math.round(seconds / 3_600);
    return hours === 1 ? t("duration.oneHour") : t("duration.hours", { n: hours });
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? t("duration.oneMinute") : t("duration.minutes", { n: minutes });
}

export function formatDaysPrecise(seconds: number, t: Translate, locale: string): string {
  const days = Math.max(0, seconds) / 86_400;
  return t("duration.daysPrecise", { n: days.toLocaleString(locale, { maximumFractionDigits: 4 }) });
}
