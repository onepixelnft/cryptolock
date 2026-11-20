function Glyph({ symbol }: { symbol: string }) {
  const base = symbol.replace(/^s(?=[A-Z])/, "").toUpperCase();
  switch (base) {
    case "ETH":
    case "WETH":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="miter">
          <path d="M12 4l5 8.2-5 3-5-3z" />
          <path d="M7 13.6l5 6.4 5-6.4-5 3z" />
        </g>
      );
    case "BTC":
    case "WBTC":
      return (
        <text x="12" y="16.2" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">
          ₿
        </text>
      );
    case "USDC":
    case "USDT":
      return (
        <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">
          $
        </text>
      );
    case "DAI":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M8.5 7.5h3.5a4.5 4.5 0 0 1 0 9H8.5z" />
          <path d="M6.5 11h11M6.5 13h11" />
        </g>
      );
    case "LINK":
      return <path d="M12 5.5l5.6 3.25v6.5L12 18.5l-5.6-3.25v-6.5z" fill="none" stroke="currentColor" strokeWidth="1.3" />;
    default:
      return (
        <text x="12" y="15.4" textAnchor="middle" fontSize="7.5" fontWeight="600" letterSpacing="0.3" fill="currentColor">
          {base.slice(0, 3)}
        </text>
      );
  }
}

export function TokenIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const isVault = /^s[A-Z]/.test(symbol);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="token-icon" aria-hidden>
      <circle cx="12" cy="12" r="11.25" fill="#fff" stroke="currentColor" strokeWidth="1" />
      {isVault && <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="0.75" />}
      <Glyph symbol={symbol} />
    </svg>
  );
}

export function WalletIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="token-icon" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" fill="#000" />
      <rect x="5" y="7.5" width="14" height="10" fill="none" stroke="#fff" strokeWidth="1.3" />
      <path d="M5 10.5h14" stroke="#fff" strokeWidth="1.3" />
    </svg>
  );
}
