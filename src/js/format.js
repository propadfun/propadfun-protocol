const cur2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const curSig = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 4 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const DASH = '—';
const ok = (n) => typeof n === 'number' && Number.isFinite(n);

export const fmtPrice = (n) => (!ok(n) ? DASH : n >= 1 ? cur2.format(n) : curSig.format(n));
export const fmtCompact = (n) => (!ok(n) ? DASH : compact.format(n));
export const fmtWhole = (n) => (!ok(n) ? DASH : whole.format(n));
export const fmtPct = (n) => {
  if (!ok(n)) return DASH;
  const a = Math.abs(n);
  const body = a >= 10000 ? compactPlain(a) : a.toFixed(2);
  return (n < 0 ? '-' : '+') + body + '%';
};
function compactPlain(n) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export const letterOf = (sym) => {
  const m = String(sym || '').match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '?';
};

// stable 0..3 tone from an address, so a tile keeps its colour between refreshes
export const toneOf = (addr) => {
  let h = 0;
  for (const c of String(addr)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4;
};
