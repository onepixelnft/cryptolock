"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./LogoMark";
import { ConnectButton } from "./ConnectButton";
import { NetworkButton } from "./NetworkButton";
import { useI18n } from "@/lib/i18n";
import type { TKey } from "@/i18n/en";

const LINKS: Array<{ href: string; key: TKey }> = [
  { href: "/", key: "nav.dashboard" },
  { href: "/wallet", key: "nav.wallet" },
  { href: "/history", key: "nav.history" },
  { href: "/settings", key: "nav.settings" },
];

export function Header() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label={`CryptoLock — ${t("a11y.home")}`}>
          <Logo />
        </Link>
        <nav className="nav" aria-label={t("nav.main")}>
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
                {t(link.key)}
              </Link>
            );
          })}
        </nav>
        <div className="header-actions">
          <NetworkButton />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
