/**
 * Money formatting.
 *
 * All API amounts are integers in the currency's *minor unit*. The number of
 * minor units per major unit is not universal: XOF is zero-decimal (one minor
 * unit is one franc, so no division at all), USD has two, and KWD has three.
 * Dividing by 100 unconditionally would show a 50 000 XOF product as 500.
 *
 * So the exponent is asked of Intl rather than assumed, and the locale is left
 * undefined so the runtime's own default is used.
 */

const exponentCache = new Map<string, number>();

export function currencyExponent(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;

  let exponent = 2;
  try {
    const resolved = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).resolvedOptions();
    exponent = resolved.maximumFractionDigits ?? 2;
  } catch {
    // Unknown or malformed code: fall back to the common case.
    exponent = 2;
  }

  exponentCache.set(currency, exponent);
  return exponent;
}

/** Convert an integer minor-unit amount to its major-unit value. */
export function toMajorUnits(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

/**
 * Parse a major-unit amount typed by a person into the integer minor units the
 * API expects. Rounds, because 12.34 * 100 is not exactly 1234 in binary
 * floating point. Returns null when the input is not a usable number.
 */
export function toMinorUnits(major: string | number, currency: string): number | null {
  const value = typeof major === 'number' ? major : Number.parseFloat(major);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10 ** currencyExponent(currency));
}

export function formatMoney(minor: number, currency = 'XOF'): string {
  const amount = toMajorUnits(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
