export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#000" />
      <path d="M24 28.5V21.5a8 8 0 0 1 16 0V28.5" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
      <rect x="14" y="26" width="36" height="27" rx="8" fill="#fff" />
      <path
        d="M32 32.6a4.2 4.2 0 0 1 2.15 7.81l.93 4.76a1 1 0 0 1-.98 1.19h-4.2a1 1 0 0 1-.98-1.19l.93-4.76A4.2 4.2 0 0 1 32 32.6z"
        fill="#000"
      />
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
