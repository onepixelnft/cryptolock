export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="688 468 556 556" aria-hidden>
      <path d="M868 909.4V973.3A247.5 247.5 0 1 1 953 993.2V936.1A190.5 190.5 0 1 0 868 909.4Z" fill="#000" />
      <circle cx="966" cy="747" r="97" fill="#000" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-name">
        Crypto<strong>Lock</strong>
      </span>
    </span>
  );
}
