"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export const GITHUB_URL = "https://github.com/onepixelnft/cryptolock";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="small muted">{t("footer.nonCustodial")}</span>
        <nav className="footer-nav small">
          <Link href="/docs">{t("footer.docs")}</Link>
          <Link href="/terms">{t("footer.terms")}</Link>
          <Link href="/security">{t("footer.security")}</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
