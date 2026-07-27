import { formatPercent } from "@/lib/format";
import type { Verdict } from "@/lib/analytics/signal";

/** Barra salita/discesa con intervallo di confidenza opzionale. */
export function ProbabilityBar({
  pUp,
  ci95,
  height = "h-2",
  showLabels = true,
}: {
  pUp: number;
  ci95?: [number, number];
  height?: string;
  showLabels?: boolean;
}) {
  const up = Math.round(pUp * 1000) / 10;
  return (
    <div className="w-full">
      {showLabels && (
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="font-semibold text-rise-500">Sale {formatPercent(up, 1)}</span>
          <span className="font-semibold text-fall-500">Scende {formatPercent(100 - up, 1)}</span>
        </div>
      )}
      <div className={`relative w-full overflow-hidden rounded-full bg-fall-600/40 ${height}`}>
        <div
          className="h-full rounded-full bg-rise-500/90 transition-[width] duration-300"
          style={{ width: `${up}%` }}
        />
        {ci95 && (
          // L'intervallo di confidenza è mostrato come banda semitrasparente:
          // rende visibile quanto la stima sia incerta.
          <div
            className="absolute inset-y-0 border-x border-base-100/50 bg-base-100/15"
            style={{ left: `${ci95[0] * 100}%`, width: `${(ci95[1] - ci95[0]) * 100}%` }}
            title={`Intervallo di confidenza 95%: ${formatPercent(ci95[0] * 100, 1)} – ${formatPercent(ci95[1] * 100, 1)}`}
          />
        )}
      </div>
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  buy: { label: "Compra", className: "bg-rise-500/15 text-rise-500 border-rise-500/30" },
  sell: { label: "Vendi", className: "bg-fall-500/15 text-fall-500 border-fall-500/30" },
  keep: { label: "Mantieni", className: "bg-hold-500/15 text-hold-500 border-hold-500/30" },
};

export function VerdictBadge({ verdict, size = "sm" }: { verdict: Verdict; size?: "sm" | "lg" }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className={`inline-flex items-center rounded-md border font-semibold ${style.className} ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]"
      }`}
    >
      {style.label}
    </span>
  );
}

/** Tre barre affiancate: compra / vendi / mantieni. */
export function SignalBars({
  buy,
  sell,
  keep,
  showValues = true,
}: {
  buy: number;
  sell: number;
  keep: number;
  showValues?: boolean;
}) {
  const rows: [string, number, string][] = [
    ["Compra", buy, "bg-rise-500"],
    ["Vendi", sell, "bg-fall-500"],
    ["Mantieni", keep, "bg-hold-500"],
  ];
  return (
    <div className="space-y-1.5">
      {rows.map(([label, value, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-base-400">{label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-800">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
          </div>
          {showValues && <span className="tabular w-10 text-right text-xs text-base-300">{value}%</span>}
        </div>
      ))}
    </div>
  );
}

/** Indicatore di affidabilità della stima. */
export function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = Math.max(1, Math.round(confidence * 5));
  const label =
    confidence > 0.66 ? "alta" : confidence > 0.4 ? "media" : "bassa";
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Affidabilità ${label} (${formatPercent(confidence * 100, 0)}): dipende da quanti dati indipendenti ci sono e da quanto i modelli concordano`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < filled ? "bg-accent-400" : "bg-base-700"}`}
        />
      ))}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  valueClassName = "",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-base-800 bg-base-900/50 px-3 py-2.5" title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-base-400">{label}</div>
      <div className={`tabular mt-0.5 text-[15px] font-semibold ${valueClassName}`}>{value}</div>
    </div>
  );
}
