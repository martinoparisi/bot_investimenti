/** Formattazione numeri in convenzione italiana. */

const LOCALE = "it-IT";

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/d";
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(
  value: number | null | undefined,
  decimals = 2,
  withSign = false,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/d";
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, decimals)}%`;
}

/** GBp = penny inglesi: Yahoo quota i titoli di Londra in centesimi di sterlina. */
export function formatPrice(
  value: number | null | undefined,
  currency: string | null | undefined,
  decimals = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/d";
  if (!currency) return formatNumber(value, decimals);
  if (currency === "GBp") return `${formatNumber(value, decimals)} p`;
  try {
    return value.toLocaleString(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return `${formatNumber(value, decimals)} ${currency}`;
  }
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/d";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${formatNumber(value / 1e12, 2)} bln`;
  if (abs >= 1e9) return `${formatNumber(value / 1e9, 2)} mld`;
  if (abs >= 1e6) return `${formatNumber(value / 1e6, 2)} mln`;
  if (abs >= 1e3) return `${formatNumber(value / 1e3, 1)} mila`;
  return formatNumber(value, 0);
}

export function formatDate(value: number | string | Date | null | undefined): string {
  if (value === null || value === undefined) return "n/d";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/d";
  return date.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: number | string | Date | null | undefined): string {
  if (value === null || value === undefined) return "n/d";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/d";
  return date.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "mai";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "adesso";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min fa`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h fa`;
  return `${Math.round(seconds / 86400)} g fa`;
}

/** Classe colore in base al segno. */
export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-base-400";
  if (value > 0) return "text-rise-500";
  if (value < 0) return "text-fall-500";
  return "text-base-300";
}

export const MONTH_NAMES = [
  "Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
  "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
];
