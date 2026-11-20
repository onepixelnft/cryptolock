"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container page">
      <div className="gate">
        <span className="eyebrow">404</span>
        <h1 className="h2">{t("notFound.title")}</h1>
        <Link href="/" className="btn">
          {t("nav.dashboard")}
        </Link>
      </div>
    </div>
  );
}
